let questions=[],bancoBloqueado=false;
let resumos=[],notaAlvoQuestao=null; // anotações rápidas coletadas durante o estudo, organizadas por matéria/subtema
let pendingImportExtras=null;
let pdfText='',numQuestoes=5,dueQueue=[],dueIdx=0,sessOk=0,sessErr=0,pendingGenerated=[],pendingImportData=null,currentCorrect=0;
let ratingLock=false,ignorarLimite=false,metaEstourada=false;
let cardMostradoEm=0, cliqueCorreto=null;
// ===== CRONÔMETRO DE ESTUDO =====
// cardTempoDescontado acumula quanto tempo ficou com a aba/janela em segundo plano
// enquanto a questão atual estava na tela — esse tempo é subtraído do cálculo do
// tempo gasto, em vez de deixar ele contar como se você estivesse estudando.
// TEMPO_MAX_QUESTAO é a rede de segurança pro que essa pausa não pegar (ex: deixou
// a ABA em primeiro plano mesmo, mas foi fazer outra coisa na mesma tela/monitor).
let cardTempoDescontado=0, ocultoDesde=null;
const TEMPO_MAX_QUESTAO=180000; // 3 minutos
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){ocultoDesde=Date.now();}
  else if(ocultoDesde){cardTempoDescontado+=Date.now()-ocultoDesde;ocultoDesde=null;}
});

// ===== PERSISTÊNCIA — IndexedDB =====
// Antes tudo vivia no localStorage, cujo teto é ~5 MB contados em UTF-16 (2 bytes por
// caractere). Com 971 questões o banco já ocupava ~3,4 MB, e daí vinham dois problemas
// silenciosos: (1) o snapshot diário, que é outra cópia integral, não cabia mais e falhava
// dentro de um catch vazio — a rede de segurança estava desligada sem avisar; (2) faltavam
// só ~440 questões para o próprio save() começar a estourar a cota.
// IndexedDB não tem esse teto, guarda um registro por questão (grava só o que mudou em vez
// de reserializar o banco inteiro a cada resposta) e aceita armazenamento persistente.
const DB_NOME='questia_db', DB_VER=2;
const ST_Q='questoes', ST_META='meta', ST_SNAP='snapshots', ST_LOG='respostas';
let db=null, idbOk=false, histCache={}, shadow=new Map(), migrouAgora=0;

// Teto do nome do conceito. O campo existe para AGRUPAR questões; acima disso
// ele deixa de ser um nome e vira descrição, e descrição nenhuma se repete.
const LIMITE_SUBTEMA=60;

function idbAbrir(){
  return new Promise((res,rej)=>{
    if(!('indexedDB' in window)||!indexedDB)return rej(new Error('IndexedDB indisponível neste navegador'));
    let req;
    try{req=indexedDB.open(DB_NOME,DB_VER);}catch(e){return rej(e);}
    req.onupgradeneeded=e=>{
      const d=e.target.result;
      if(!d.objectStoreNames.contains(ST_Q))d.createObjectStore(ST_Q,{keyPath:'id'});
      if(!d.objectStoreNames.contains(ST_META))d.createObjectStore(ST_META);
      if(!d.objectStoreNames.contains(ST_SNAP))d.createObjectStore(ST_SNAP);
      // Registro de respostas: cada resposta vira uma linha com data. Os contadores
      // acertos/erros da questão são totais de vida inteira e não sabem QUANDO nada
      // aconteceu — sem isto não existe "desempenho recente", só "desempenho de sempre".
      if(!d.objectStoreNames.contains(ST_LOG)){
        const st=d.createObjectStore(ST_LOG,{keyPath:'seq',autoIncrement:true});
        st.createIndex('ts','ts');
        st.createIndex('qid','qid');
      }
    };
    req.onsuccess=e=>res(e.target.result);
    req.onerror=()=>rej(req.error||new Error('falha ao abrir o banco'));
    req.onblocked=()=>rej(new Error('banco bloqueado por outra aba do QuestIA'));
  });
}
function txFim(tx){return new Promise((res,rej)=>{tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error||new Error('transação abortada'));});}
function idbReq(r){return new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
function idbTodos(st){return idbReq(db.transaction(st,'readonly').objectStore(st).getAll());}
function idbChaves(st){return idbReq(db.transaction(st,'readonly').objectStore(st).getAllKeys());}
function idbLer(st,k){return idbReq(db.transaction(st,'readonly').objectStore(st).get(k));}
async function idbGravar(st,valor,k){const tx=db.transaction(st,'readwrite');tx.objectStore(st).put(valor,k);await txFim(tx);}
async function idbApagar(st,k){const tx=db.transaction(st,'readwrite');tx.objectStore(st).delete(k);await txFim(tx);}

// ===== MODO DE EMERGÊNCIA =====
// Se o IndexedDB não abrir (navegador antigo, modo privado restritivo, perfil corrompido),
// o app não pode simplesmente morrer: volta a ler e gravar no localStorage como antes.
function carregarDoLocalStorage(){
  let raw=null;try{raw=localStorage.getItem('questia_v3');}catch(e){}
  if(raw===null||raw===''){questions=[];return;}
  try{
    const p=JSON.parse(raw);
    if(!Array.isArray(p))throw new Error('formato inesperado');
    questions=p;
  }catch(e){
    bancoBloqueado=true;questions=[];
    try{localStorage.setItem('questia_v3_RESGATE_'+Date.now(),raw);}catch(_){}
    setTimeout(()=>alert('⚠️ Não consegui ler o banco de questões.\n\nO conteúdo original foi copiado para uma chave de resgate e NADA foi apagado. A gravação está bloqueada para proteger seus dados.\n\nVá em Backup → Importar e carregue seu último .json.'),200);
  }
}

// ===== MIGRAÇÃO =====
// Roda uma única vez. O localStorage NÃO é apagado aqui de propósito: ele vira a cópia
// congelada de segurança até você confirmar que está tudo certo (botão na aba Backup).
async function migrarDoLocalStorage(){
  // A condição de parada é o IndexedDB JÁ TER dados — não a flag "migrado".
  // Guiar-se pela flag quebrava um caso real: abrir o app uma vez antes de o banco
  // existir gravava migrado=true, e a migração de verdade nunca mais acontecia.
  // Para que apagar o banco não ressuscite a cópia velha, limparTudo() remove a
  // chave antiga do localStorage junto.
  const qtdIDB=(await idbChaves(ST_Q)).length;
  if(qtdIDB>0)return 0;

  let raw=null;try{raw=localStorage.getItem('questia_v3');}catch(e){}
  if(!raw||raw==='[]'){await idbGravar(ST_META,true,'migrado_v3');return 0;}

  let arr;
  try{
    arr=JSON.parse(raw);
    if(!Array.isArray(arr))throw new Error('formato inesperado');
  }catch(e){
    bancoBloqueado=true;
    try{localStorage.setItem('questia_v3_RESGATE_'+Date.now(),raw);}catch(_){}
    setTimeout(()=>alert('⚠️ Não consegui ler o banco antigo para migrar.\n\nNADA foi apagado e a gravação está bloqueada. Vá em Backup → Importar e carregue seu último .json.'),200);
    return 0;
  }

  const tx=db.transaction(ST_Q,'readwrite'),st=tx.objectStore(ST_Q),vistos=new Set();
  arr.forEach((q,i)=>{
    // id é a chave primária agora: qualquer ausente ou repetido ganha um novo,
    // senão um registro sobrescreveria o outro e a questão sumiria na calada.
    if(q.id===undefined||q.id===null||vistos.has(q.id))q.id=Date.now()+i+Math.random();
    vistos.add(q.id);
    st.put(q);
  });
  await txFim(tx);
  await idbGravar(ST_META,true,'migrado_v3');
  await idbGravar(ST_META,new Date().toISOString(),'migrado_em');
  return arr.length;
}

async function migrarHist(){
  // Mesma armadilha da migração do banco: um objeto vazio no IndexedDB é "truthy"
  // e faria o histórico do localStorage ser ignorado para sempre. Aqui o que manda
  // é ter dias gravados, e dias que só existem no localStorage são incorporados.
  const noIDB=await idbLer(ST_META,'hist');
  let doLS={};
  try{doLS=JSON.parse(localStorage.getItem('questia_hist')||'{}');}catch(e){}
  if(noIDB&&typeof noIDB==='object'&&Object.keys(noIDB).length){
    let mudou=false;
    for(const dia in doLS)if(!(dia in noIDB)){noIDB[dia]=doLS[dia];mudou=true;}
    histCache=noIDB;
    if(mudou)await idbGravar(ST_META,histCache,'hist');
    return;
  }
  histCache=doLS;
  if(Object.keys(histCache).length)await idbGravar(ST_META,histCache,'hist');
}

async function iniciarPersistencia(){
  try{
    db=await idbAbrir();
    idbOk=true;
  }catch(e){
    idbOk=false;
    carregarDoLocalStorage();
    try{histCache=JSON.parse(localStorage.getItem('questia_hist')||'{}');}catch(_){histCache={};}
    setTimeout(()=>notify('⚠️ IndexedDB indisponível ('+e.message+'). Operando no modo antigo, com limite de 5 MB. Exporte backups com frequência.','err'),600);
    return;
  }
  try{
    migrouAgora=await migrarDoLocalStorage();
    await migrarHist();
    questions=await idbTodos(ST_Q);
    shadow=new Map(questions.map(q=>[q.id,JSON.stringify(q)]));
  }catch(e){
    idbOk=false;bancoBloqueado=false;
    carregarDoLocalStorage();
    setTimeout(()=>notify('⚠️ Falha ao migrar ('+e.message+'). Continuo no modo antigo — seus dados não foram tocados.','err'),600);
    return;
  }
  // Sem isto o navegador pode descartar o IndexedDB sozinho quando o disco apertar.
  try{
    if(navigator.storage&&navigator.storage.persist){
      const jaEh=navigator.storage.persisted?await navigator.storage.persisted():false;
      if(!jaEh)await navigator.storage.persist();
    }
  }catch(e){/* alguns navegadores não expõem — não é fatal */}
}

// ===== GRAVAÇÃO =====
// Grava só os registros que mudaram de verdade. O `shadow` guarda o JSON da última
// versão gravada de cada questão; responder uma questão escreve 1 registro, não 971.
async function gravarBanco(){
  const tx=db.transaction(ST_Q,'readwrite'),st=tx.objectStore(ST_Q),vistos=new Set();
  for(const q of questions){
    vistos.add(q.id);
    const j=JSON.stringify(q);
    if(shadow.get(q.id)!==j){st.put(q);shadow.set(q.id,j);}
  }
  for(const id of[...shadow.keys()])if(!vistos.has(id)){st.delete(id);shadow.delete(id);}
  await txFim(tx);
}
function save(){
  if(bancoBloqueado){notify('Gravação bloqueada — o banco não pôde ser lido. Restaure um backup antes.','err');return;}
  updateMateriaDatalist();
  if(!idbOk){
    try{localStorage.setItem('questia_v3',JSON.stringify(questions));}
    catch(e){notify('❌ FALHA AO SALVAR: '+(e.name==='QuotaExceededError'?'armazenamento cheio':e.message)+'. Exporte um backup agora!','err');}
    return;
  }
  gravarBanco().catch(e=>notify('❌ FALHA AO SALVAR: '+(e&&e.message||e)+'. Exporte um backup agora!','err'));
}
function salvarHist(){
  if(idbOk)idbGravar(ST_META,histCache,'hist').catch(()=>{});
  else{try{localStorage.setItem('questia_hist',JSON.stringify(histCache));}catch(e){}}
}

// RESUMOS — anotações breves feitas durante o estudo, ancoradas em matéria + subtema
// da questão de origem. Guardado à parte do banco de questões: apagar/editar uma
// questão não deve arrancar as anotações que já foram tiradas dela.
function loadResumos(){try{resumos=JSON.parse(localStorage.getItem('questia_resumos')||'[]');}catch(e){resumos=[];}}
function saveResumos(){try{localStorage.setItem('questia_resumos',JSON.stringify(resumos));}catch(e){notify('❌ Falha ao salvar o resumo (armazenamento cheio?)','err');}}

// ===== REGISTRO DE RESPOSTAS =====
// Grava o que os contadores não guardam: quando foi, em que assunto, e se a
// ALTERNATIVA clicada estava certa — que é o dado honesto de acerto. A nota dos
// quatro botões diz o quanto você quer rever, não se você acertou.
function registrarResposta(q,nota,acertouClique,ms){
  if(!idbOk)return;
  try{
    const tx=db.transaction(ST_LOG,'readwrite');
    tx.objectStore(ST_LOG).add({
      ts:Date.now(), dia:today(), qid:q.id,
      materia:(q.materia||'').trim(), subtema:(q.subtema||'').trim(),
      fonte:q.fonte||'ia', nota:nota,
      acertouClique:(acertouClique===null||acertouClique===undefined)?null:!!acertouClique,
      ms:ms>0&&ms<600000?ms:null // já vem calculado (limitado a 3min) de quem chamou; blindagem extra contra valor bugado (negativo ou absurdamente alto)
    });
  }catch(e){console.warn('[QuestIA] log de resposta falhou:',e);}
}
async function lerLog(desdeTs){
  if(!idbOk)return[];
  try{
    const tx=db.transaction(ST_LOG,'readonly'),st=tx.objectStore(ST_LOG);
    if(!desdeTs)return await idbReq(st.getAll());
    return await idbReq(st.index('ts').getAll(IDBKeyRange.lowerBound(desdeTs)));
  }catch(e){return[];}
}
async function statsLog(){
  const L=await lerLog();
  if(!L.length)return{total:0};
  const dias=new Set(L.map(x=>x.dia));
  const comClique=L.filter(x=>x.acertouClique!==null);
  return{total:L.length,dias:dias.size,desde:L[0]&&L[0].dia,
         acertoReal:comClique.length?Math.round(comClique.filter(x=>x.acertouClique).length/comClique.length*100):null,
         comClique:comClique.length};
}

// ===== SNAPSHOTS AUTOMÁTICOS =====
// Uma cópia por dia de uso, agora dentro do IndexedDB — onde de fato cabem.
// No localStorage a segunda cópia estourava a cota e era engolida por um catch vazio.
async function snapshotSeguranca(){
  if(!idbOk||bancoBloqueado||!questions.length)return;
  try{
    const k=today();
    if(!await idbLer(ST_SNAP,k))
      await idbGravar(ST_SNAP,{data:k,qtd:questions.length,questoes:questions},k);
    const chaves=(await idbChaves(ST_SNAP)).sort();
    while(chaves.length>7)await idbApagar(ST_SNAP,chaves.shift());
  }catch(e){console.warn('[QuestIA] snapshot falhou:',e);}
}
async function listarSnapshots(){
  if(!idbOk)return[];
  try{
    const chaves=(await idbChaves(ST_SNAP)).sort().reverse();
    const out=[];
    for(const k of chaves){const s=await idbLer(ST_SNAP,k);out.push({chave:k,data:k,qtd:s&&s.qtd||0});}
    return out;
  }catch(e){return[];}
}
async function restaurarSnapshot(chave){
  if(!idbOk)return;
  const s=await idbLer(ST_SNAP,chave);
  if(!s||!Array.isArray(s.questoes)){notify('Snapshot ilegível','err');return;}
  if(!confirm(`Restaurar o snapshot de ${chave} com ${s.questoes.length} questões?\n\nO banco atual (${questions.length}) será SUBSTITUÍDO.\nExporte um .json antes se tiver dúvida.`))return;
  bancoBloqueado=false;questions=s.questoes.map(q=>Object.assign({},q));save();updateSidebar();renderBackupInfo();
  notify(`✓ Snapshot restaurado — ${questions.length} questões`,'ok');
}

// ===== ESPAÇO EM DISCO =====
async function medirEspaco(){
  try{
    if(!navigator.storage||!navigator.storage.estimate)return null;
    const e=await navigator.storage.estimate();
    const persistente=navigator.storage.persisted?await navigator.storage.persisted():false;
    return{uso:e.usage||0,cota:e.quota||0,persistente};
  }catch(x){return null;}
}
function tamanhoLocalStorageAntigo(){
  try{const raw=localStorage.getItem('questia_v3');return raw?raw.length*2:0;}catch(e){return 0;}
}
function liberarLocalStorageAntigo(){
  const bytes=tamanhoLocalStorageAntigo();
  if(!bytes){notify('Não há cópia antiga para liberar','ok');return;}
  if(!confirm(`Apagar a cópia antiga do banco no localStorage (${(bytes/1048576).toFixed(1)} MB)?\n\nSeus dados continuam no IndexedDB, que é o que o app usa agora.\nFaça um backup .json antes se quiser dormir tranquilo.`))return;
  try{
    localStorage.removeItem('questia_v3');
    Object.keys(localStorage).filter(k=>k.indexOf('questia_snap_')===0).forEach(k=>localStorage.removeItem(k));
    notify('✓ Espaço antigo liberado','ok');renderBackupInfo();
  }catch(e){notify('Não consegui liberar: '+e.message,'err');}
}
function fmtBytes(b){return b>=1048576?(b/1048576).toFixed(1)+' MB':(b/1024).toFixed(0)+' KB';}

// FORMATAÇÃO DE TEXTO — quebra itens numerados (1. 2. 3...) e romanos (I. II. III...) em parágrafos
// Marcadores [[IMG:dataURL]] / [[IMAGEM NÃO IMPORTADA]] vêm de textoDeDocx() —
// entram como texto puro (sem < > &) pra sobreviver ao escape abaixo e só viram
// HTML de verdade aqui, igual ao **negrito** do markdown do coletor.
// [[IMG-URL:https://...]] vem do "TEC coletor em página" (userscript): ele lê o
// enunciado pela API do TEC, não baixa a imagem, só guarda a URL de onde ela
// mora lá. Funciona igual ao [[IMG:...]] de base64 acima, com uma diferença:
// se a URL do TEC parar de responder (ex.: exige login), a imagem some — ao
// contrário da base64, que fica gravada para sempre dentro do próprio arquivo.
function imgFalhouCarregar(img){
  img.outerHTML='<div style="border:1.5px dashed var(--accent);border-radius:8px;padding:8px 12px;margin:8px 0;font-size:12px;color:var(--accent);background:rgba(220,38,38,.06)">⚠️ Imagem não carregou (a URL do TecConcursos pode exigir login ou ter expirado).</div>';
}
function desenharImagensDaQuestao(html){
  html=html.replace(/\[\[IMG:(data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+)\]\]/gi,
    '<img src="$1" alt="Imagem da questão" style="max-width:100%;border-radius:8px;margin:8px 0;display:block">');
  html=html.replace(/\[\[IMG-URL:(https?:\/\/[^\]\s"']+)\]\]/gi,
    '<img src="$1" alt="Imagem da questão (carregada do TecConcursos)" loading="lazy" onerror="imgFalhouCarregar(this)" style="max-width:100%;border-radius:8px;margin:8px 0;display:block">');
  html=html.replace(/\[\[IMAGEM N[ÃA]O IMPORTADA\]\]/gi,
    '<div style="border:1.5px dashed var(--accent);border-radius:8px;padding:8px 12px;margin:8px 0;font-size:12px;color:var(--accent);background:rgba(220,38,38,.06)">⚠️ Esta questão tinha uma imagem/gráfico no arquivo original que não pôde ser importado automaticamente — confira o documento fonte.</div>');
  return html;
}
// Linhas "célula | célula | célula" (produzidas por converterTabelasParaTexto,
// a partir de uma <w:tbl> de verdade do Word) viravam só texto corrido com
// pipe solto. Aqui, duas ou mais linhas seguidas nesse formato são desenhadas
// como tabela — a primeira linha como cabeçalho — em vez de aparecerem como
// texto plano. Roda ANTES do escape geral: extrai o bloco, gera o HTML já
// seguro (células escapadas aqui mesmo) e devolve um marcador que sobrevive
// ao escape/format geral, trocado pelo HTML de verdade no final.
// Tabela extraída de PDF às vezes chega SEM pipe nenhum: cada célula na sua
// própria linha, uma atrás da outra — rótulo, valor, rótulo, valor — igual
// aconteceu com "Rubrica / Valor (milhões US$) / Aluguel de Equipamentos / (7) /
// Derivativos / 15 / ...". O extrator de tabela normal só reconhece "célula |
// célula" (formato que vem do .docx); essas linhas soltas passavam batido e
// viravam uma pilha de parágrafos desconexos, sem pista nenhuma de que eram uma
// tabela de duas colunas.
// A reconstrução é deliberadamente conservadora: só junta em "rótulo | valor"
// quando, tirando as duas linhas de cabeçalho, pelo menos 70% das linhas da
// segunda coluna têm cara de número (inteiro, decimal, negativo entre
// parênteses, %, R$/US$). Enunciado corrido não tem essa alternância regular
// entre texto e número — é isso que separa uma tabela desmontada de uma lista
// comum de frases curtas, e mantém baixo o risco de reformatar algo que não
// deveria virar tabela.
const RE_CELULA_VALOR=/^\(?-?\s*(?:r\$|us\$|€|£)?\s*-?\d[\d.,]*\)?%?$/i;
const RE_MARCADOR_LISTA_CEL=/^(?:[IVXLCDM]{1,4}[.\-)]|[A-Ea-e]\)|\d{1,2}[.)])\s/;
// Classifica uma célula solta em 'num' (número/valor, cobre o que RE_CELULA_VALOR
// pega), 'code' (token curto sem espaço — código, sigla, nome de coluna) ou 'text'
// (frase/nome com espaço, ou longo demais para ser célula de tabela).
function classificarCelula(s){
  if(RE_CELULA_VALOR.test(s))return'num';
  if(/^[A-Za-zÀ-ÖØ-öø-ÿ0-9]{1,10}$/.test(s))return'code';
  return'text';
}
// Tenta decidir, para uma sequência de linhas soltas, se ela é uma tabela achatada
// (cada célula em sua própria linha) e, se for, com quantas colunas e a partir de
// que ponto (ver 'inicio'/'fimExclusivo' abaixo). Antes o código só reconhecia
// tabelas de exatamente 2 colunas e só permitia cortar até 1 linha do INÍCIO da
// sequência (pra ignorar um título solto tipo "**Tabela Processo**"). Só que uma
// linha "vazando" pode acontecer nas DUAS pontas: no fim, quando a frase seguinte
// ao valor da última célula continua na mesma sequência solta (ex.: "...59.389" /
// "Considerando os números publicados,"). Por isso agora também testa cortar 1
// linha do FIM.
function avaliarTabela(corrida){
  const nTotal=corrida.length;
  if(nTotal<6)return null;
  let melhor=null;
  for(let trimStart=0;trimStart<=1;trimStart++){
    for(let trimEnd=0;trimEnd<=1;trimEnd++){
      const inicio=trimStart,fimExclusivo=nTotal-trimEnd;
      const n=fimExclusivo-inicio;
      if(n<6)continue;
      // Uma vírgula no fim da última linha usada quase sempre denuncia frase que
      // continua na linha seguinte — não é célula de tabela de verdade. Sem
      // cortar essa linha (trimEnd=1), essa configuração nem entra na disputa.
      if(trimEnd===0&&/,$/.test(corrida[nTotal-1]))continue;
      // Uma linha inteira em negrito (ex.: "**Tabela X**") é título de seção, não
      // célula de dado — se ela cair dentro do intervalo usado (em vez de ficar de
      // fora, cortada por trimStart), descarta a configuração de cara. Sem isso, um
      // título assim podia "roubar" uma vaga de coluna e desalinhar a tabela toda.
      let temTituloIsolado=false;
      for(let k=inicio;k<fimExclusivo;k++){if(/^\*\*.+\*\*$/.test(corrida[k])){temTituloIsolado=true;break;}}
      if(temTituloIsolado)continue;
      for(let nCols=2;nCols<=6;nCols++){
        if(n<=nCols)continue;
        const nDataRows=(n-nCols)/nCols;
        // exige pelo menos 2 linhas de dados: com só 1 linha, qualquer nCols "acerta"
        // trivialmente porque não há nada para comparar entre linhas.
        if(!Number.isInteger(nDataRows)||nDataRows<2)continue;
        let pontosTotais=0,temColunaDeValor=false;
        for(let c=0;c<nCols;c++){
          const classes={};
          for(let r=0;r<nDataRows;r++){
            const v=corrida[inicio+nCols+r*nCols+c];
            const cls=classificarCelula(v);
            classes[cls]=(classes[cls]||0)+1;
          }
          const maiorClasse=Math.max(...Object.values(classes));
          pontosTotais+=maiorClasse/nDataRows;
          if((classes.num||0)/nDataRows>=0.5||(classes.code||0)/nDataRows>=0.5)temColunaDeValor=true;
        }
        const score=pontosTotais/nCols;
        // além de as colunas serem "regulares" (mesmo tipo de célula ao longo da
        // coluna), pelo menos uma precisa parecer dado de verdade (número/código) —
        // isso evita transformar um parágrafo comum, quebrado em linhas curtas, numa
        // tabela falsa só porque o texto por acaso repete um padrão.
        if(score>=0.75&&temColunaDeValor){
          const candidato={inicio,fimExclusivo,nCols,score,nDataRows,trim:trimStart+trimEnd};
          // em empate (diferença pequena de score), prefere quem tem MAIS linhas de
          // dados — sinal mais confiável de nCols certo — e, se ainda empatado,
          // quem exigiu MENOS corte (mexeu menos na sequência original).
          if(!melhor||candidato.score>melhor.score+0.02||
             (Math.abs(candidato.score-melhor.score)<=0.02&&candidato.nDataRows>melhor.nDataRows)||
             (Math.abs(candidato.score-melhor.score)<=0.02&&candidato.nDataRows===melhor.nDataRows&&candidato.trim<melhor.trim)){
            melhor=candidato;
          }
        }
      }
    }
  }
  return melhor;
}
function montarLinhasDaTabela(corrida,melhor){
  const{inicio,fimExclusivo,nCols}=melhor;
  const linhasSaida=[];
  for(let k=0;k<inicio;k++)linhasSaida.push(corrida[k]);
  linhasSaida.push(corrida.slice(inicio,inicio+nCols).join(' | '));
  for(let k=inicio+nCols;k<fimExclusivo;k+=nCols)linhasSaida.push(corrida.slice(k,k+nCols).join(' | '));
  for(let k=fimExclusivo;k<corrida.length;k++)linhasSaida.push(corrida[k]);
  return linhasSaida;
}
function tentarMontarTabela(corrida){
  const melhor=avaliarTabela(corrida);
  return melhor?montarLinhasDaTabela(corrida,melhor):null;
}
function reconstruirTabelaEmLinhasSoltas(linhas){
  const saida=[];
  let i=0;
  while(i<linhas.length){
    let j=i;
    while(j<linhas.length){
      const l=linhas[j].trim();
      if(!l||l.length>70||/[.!?;:]$/.test(l)||RE_MARCADOR_LISTA_CEL.test(l))break;
      j++;
    }
    const corrida=linhas.slice(i,j).map(l=>l.trim());
    let melhor=avaliarTabela(corrida),corridaFinal=corrida,consumiuAnterior=false;
    // A linha imediatamente anterior pode ter interrompido a sequência só por
    // terminar em ":" (ex.: "Resultado Nominal:") — mas isso é rótulo de linha de
    // tabela, não fim de frase. Testa incluir ela como possível primeira célula, e
    // só aceita se isso realmente melhorar a qualidade encontrada (ou for a única
    // opção válida).
    if(saida.length){
      const anterior=String(saida[saida.length-1]).trim();
      if(anterior&&anterior.length<=80&&!/[\u0003\u0004]/.test(anterior)){
        const candidata=[anterior,...corrida];
        const melhorEstendida=avaliarTabela(candidata);
        if(melhorEstendida&&(!melhor||melhorEstendida.score>melhor.score+0.02||
           (Math.abs(melhorEstendida.score-melhor.score)<=0.02&&melhorEstendida.nDataRows>melhor.nDataRows))){
          melhor=melhorEstendida;corridaFinal=candidata;consumiuAnterior=true;
        }
      }
    }
    if(melhor){
      if(consumiuAnterior)saida.pop();
      saida.push(...montarLinhasDaTabela(corridaFinal,melhor));
      i=j;continue;
    }
    saida.push(linhas[i]);
    i++;
  }
  return saida;
}
const RE_PALAVRA_CODIGO=/^(SELECT|FROM|WHERE|JOIN|INNER\s+JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|FULL\s+JOIN|CROSS\s+APPLY|OUTER\s+APPLY|ORDER\s+BY|GROUP\s+BY|HAVING|INSERT\s+INTO|VALUES|UPDATE|SET|DELETE\s+FROM|CREATE\s+(?:TABLE|INDEX|VIEW|PROCEDURE|DATABASE)|ALTER\s+TABLE|DROP\s+TABLE|DECLARE|EXEC(?:UTE)?|WITH|UNION(?:\s+ALL)?|CASE|WHEN|THEN|ELSE|END|BEGIN|PRINT|GO|WHILE|LIMIT|OFFSET|FETCH|PARTITION\s+BY)\b/i;
// Reconhece uma linha "solta" que parece pedaço de código (SQL, principalmente):
// começa com palavra-chave, termina com vírgula (lista de colunas de um SELECT),
// ou é do tipo "alias.coluna" / "FUNCAO(args) AS apelido".
function classificarLinhaComoCodigo(s){
  if(!s||s.length>140)return false;
  // "Depreciação........................................." é um item de quadro
  // com líder pontilhado, não uma coluna "alias.coluna" de SELECT: o teste de
  // \S+.\S+ lá embaixo achava que era código e jogava o quadro inteiro dentro
  // de um <pre>.
  if(RE_LIDER_SEM_VALOR.test(s)||RE_LIDER_PONTILHADO.test(s))return false;
  if(RE_PALAVRA_CODIGO.test(s))return true;
  if(/,$/.test(s))return true;
  if(/^\S+\.\S+(\s+AS\s+\S+)?,?$/i.test(s))return true;
  if(/^[A-Za-z_]\w*\s*\([^()]*\)(\s+AS\s+\w+)?,?$/i.test(s))return true;
  return false;
}
// Questões com um trecho de SQL/código costumam vir do PDF com cada linha do
// comando separada por linha em branco (cada linha do código virou um "parágrafo"
// próprio na extração). Isso faz cada cláusula do SELECT aparecer como bloco
// isolado, com espaçamento de parágrafo entre elas — errado para código, que
// deveria aparecer junto, em fonte monoespaçada, como no material original.
// Aqui a gente identifica essas sequências de linhas "com cara de código" (mesmo
// com linha em branco entre elas) e agrupa tudo num único bloco <pre>.
function extrairBlocosDeCodigo(texto){
  const linhas=String(texto).split('\n');
  const saida=[];
  const blocos=[];
  let buffer=[];
  function flush(){
    if(buffer.length>=3){
      const escapado=buffer.map(l=>l.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')).join('\n');
      const html='<pre style="background:#0d0f14;border:1px solid #2c3352;border-radius:6px;'
        +'padding:10px 14px;margin:10px 0;overflow-x:auto;font-family:ui-monospace,Consolas,monospace;'
        +'font-size:12.5px;line-height:1.6;white-space:pre-wrap;color:var(--ink)">'+escapado+'</pre>';
      saida.push('\u0004COD'+blocos.length+'\u0004');
      blocos.push(html);
    }else{
      for(const l of buffer)saida.push(l);
    }
    buffer=[];
  }
  for(const l of linhas){
    const s=l.trim();
    if(!s){
      // linha em branco: se já estamos acumulando candidatas a código, ignora (não
      // quebra a sequência); senão é espaçamento normal de texto, preserva.
      if(buffer.length)continue;
      saida.push(l);
      continue;
    }
    if(classificarLinhaComoCodigo(s))buffer.push(s);
    else{flush();saida.push(l);}
  }
  flush();
  return{texto:saida.join('\n'),blocos};
}
// LISTA PONTILHADA ("líder de pontos")
// A banca alinha rótulo e valor com uma fileira de pontos:
//   Estoques ...................................... 2.500,00
// Cada item está numa linha própria no texto guardado — o dado está INTEIRO.
// O que quebrava era só a renderização: mais abaixo, em formatQuestionText,
// toda quebra de linha solta vira um espaço (isso é de propósito, por causa da
// quebra de "wrap" que vem do PDF). A lista inteira virava então um parágrafo
// corrido, com rótulo e valor emendados. Aqui cada corrida de 2+ linhas
// pontilhadas vira uma tabela de duas colunas, sem cabeçalho e com o valor à
// direita — que é como a banca imprime o quadro.
// O pontilhado às vezes vem partido ("Estoques ..... ..... 2.500,00"), por isso
// o líder aceita espaços no meio e o que sobrar de ponto do lado do valor é
// aparado. Exige 4+ pontos para não confundir com reticências de frase.
const RE_LIDER_PONTILHADO=/^(.*?\S)[ \t]*[.·•…](?:[ \t]*[.·•…]){3,}[ \t]*(\S.*?)[ \t]*$/;
// Variante: o pontilhado termina a linha e o valor caiu na linha de baixo.
const RE_LIDER_SEM_VALOR=/^(.*?\S)[ \t]*[.·•…](?:[ \t]*[.·•…]){3,}[ \t]*$/;
// O que pode ser um valor solto na linha seguinte: só número, com R$, sinal,
// parênteses de negativo ou %. Nada de frase — senão engoliria o texto do
// enunciado logo abaixo do quadro.
const RE_VALOR_SOLTO=/^[(\[]?\s*[-−+]?\s*(?:R\$|US\$|€)?\s*[-−+]?\s*\d[\d.,]*\s*%?\s*[)\]]?\.?$/;
// Separa o **negrito** que envolve a linha inteira, para ele não ficar com os
// asteriscos partidos entre as duas células (o rótulo ficaria com o "**" de
// abertura e o valor com o de fechamento, e aí nenhum dos dois vira negrito).
function tirarNegritoDaLinha(s){
  const m=String(s).match(/^\*\*([\s\S]*)\*\*$/);
  if(m&&m[1].indexOf('**')<0)return{corpo:m[1].trim(),negrito:true};
  return{corpo:String(s),negrito:false};
}
function extrairListasPontilhadas(linhas,tabelas){
  const saida=[];
  let bufer=[];
  const escCel=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*([^*]{1,200}?)\*\*/g,'<strong>$1</strong>')
    .replace(/\*\*/g,'');   // "T**otal do Ativo ..... 2.100**": asterisco solto da extração
  function fecharBufer(){
    if(bufer.length>=2){
      const trs=bufer.map(it=>
        '<tr><td style="padding:5px 14px 5px 0;font-size:12.5px;border-bottom:1px solid var(--border);color:var(--ink)">'+escCel(it.rotulo)+'</td>'+
        '<td style="padding:5px 0 5px 14px;font-size:12.5px;border-bottom:1px solid var(--border);color:var(--ink);text-align:right;white-space:nowrap">'+escCel(it.valor)+'</td></tr>').join('');
      saida.push('\u0003TBL'+tabelas.length+'\u0003');
      tabelas.push('<table style="border-collapse:collapse;width:100%;margin:10px 0">'+trs+'</table>');
    }else{
      for(const it of bufer)for(const o of it.originais)saida.push(o);
    }
    bufer=[];
  }
  // Linha em branco NO MEIO do quadro não encerra a lista: o balanço de duas
  // colunas costuma vir com uma linha vazia entre cada par (ativo à esquerda,
  // passivo à direita), e sem isto cada par virava uma tabelinha de 2 linhas e
  // os itens sozinhos ficavam com o pontilhado cru. As vazias que sobrarem no
  // fim do quadro voltam, para não colar o parágrafo seguinte na tabela.
  let pendentes=[];
  for(let i=0;i<linhas.length;i++){
    const l=linhas[i];
    const s=String(l).trim();
    if(!s){ if(bufer.length)pendentes.push(l); else saida.push(l); continue; }
    // Linha que JÁ tem pipe é linha de tabela — o caminho das tabelas cuida dela.
    // Sem esta guarda, um quadro em que a própria CÉLULA usa pontilhado
    // ("Ativo Circulante ....... 600 | Passivo Circulante ....... 700") tinha a
    // metade esquerda convertida aqui e a linha saía partida, com o pipe cru.
    if(/\S\s*\|\s*\S/.test(s)){fecharBufer();for(const p of pendentes)saida.push(p);pendentes=[];saida.push(l);continue;}
    const nl=tirarNegritoDaLinha(s);
    const forte=t=>(nl.negrito&&t)?'**'+t+'**':t;
    let item=null;
    const m=nl.corpo.match(RE_LIDER_PONTILHADO);
    if(m){
      const v=m[2].replace(/^[.·•… \t]+/,'').trim();
      if(v)item={rotulo:forte(m[1].trim()),valor:forte(v),originais:[l]};
    }
    if(!item){
      const mv=nl.corpo.match(RE_LIDER_SEM_VALOR);
      if(mv){
        item={rotulo:forte(mv[1].trim()),valor:'',originais:[l]};
        // o valor pode ter caído na linha de baixo (pulando linhas em branco)
        let j=i+1;
        while(j<linhas.length&&!String(linhas[j]).trim())j++;
        if(j<linhas.length){
          const nv=tirarNegritoDaLinha(String(linhas[j]).trim());
          if(RE_VALOR_SOLTO.test(nv.corpo)){
            item.valor=nv.negrito?'**'+nv.corpo+'**':nv.corpo;
            for(let k=i+1;k<=j;k++)item.originais.push(linhas[k]);
            i=j;
          }
        }
      }
    }
    if(item){bufer.push(item);pendentes=[];}
    else{fecharBufer();for(const p of pendentes)saida.push(p);pendentes=[];saida.push(l);}
  }
  fecharBufer();
  for(const p of pendentes)saida.push(p);
  return saida;
}
function extrairTabelasComoHtml(texto){
  const tabelas=[];
  const linhas=extrairListasPontilhadas(reconstruirTabelaEmLinhasSoltas(String(texto).split('\n')),tabelas);
  const saida=[];
  let bufer=[];
  // Depois de escapar, ainda converte **negrito** — o cabeçalho de uma tabela
  // remontada a partir de linhas soltas (reconstruirTabelaEmLinhasSoltas) pode
  // chegar com marcação de negrito, e essa etapa roda ANTES da que faz isso no
  // resto do texto, então sem isto os asteriscos apareceriam crus dentro da célula.
  const escCel=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*([^*]{1,200}?)\*\*/g,'<strong>$1</strong>');
  function fecharBufer(){
    if(bufer.length>=2){
      // O marcador de lista do markdown ("- ") abre cada linha da tabela nos arquivos
      // do coletor. Ele delimita a linha, não faz parte do dado: sem tirá-lo, a
      // primeira coluna sai "- Ano", "- 2022", "- Balança comercial (bens)".
      // Só no INÍCIO da linha — um "- 9.762" no meio é valor negativo, não marcador.
      const linhasCel=bufer.map(l=>l.startsWith('\u0004')?null:l.replace(/^\s*[-*\u2022]\s+/,'').split(/\s*\|\s*/));
      const nCols=Math.max(...linhasCel.filter(Boolean).map(l=>l.length));
      const linhasHtml=linhasCel.map((cels,i)=>{
        if(!cels)return'<tr><td colspan="'+nCols+'" style="padding:7px 12px;font-size:12px;border:1px solid var(--border);color:var(--ink);font-weight:600">'+escCel(bufer[i].slice(1))+'</td></tr>';
        const tds=[];
        for(let c=0;c<nCols;c++){
          const conteudo=escCel(cels[c]||'');
          tds.push(i===0
            ?'<th style="background:#1e2338;color:#fff;padding:8px 12px;font-size:12px;text-align:left;border:1px solid #2c3352">'+conteudo+'</th>'
            :'<td style="padding:7px 12px;font-size:12px;border:1px solid var(--border);color:var(--ink)">'+conteudo+'</td>');
        }
        return'<tr>'+tds.join('')+'</tr>';
      }).join('');
      const html='<table style="border-collapse:collapse;width:100%;margin:10px 0;font-size:12px">'+linhasHtml+'</table>';
      saida.push('\u0003TBL'+tabelas.length+'\u0003');
      tabelas.push(html);
    }else if(bufer.length===1){
      saida.push(bufer[0]);
    }
    bufer=[];
  }
  // Linha de SEÇÃO dentro do quadro ("Imobilizado", "(−) Despesas Operacionais"):
  // vem sem nenhum "|" porque só tem o rótulo, e partia a tabela em duas, com o
  // rótulo solto no meio como parágrafo. Se ela está colada entre duas linhas
  // de tabela e é curta, vira uma linha da própria tabela ocupando a largura toda.
  const ehLinhaTabela=l=>/\S\s*\|\s*\S/.test(l||'');
  const ehRotuloSecao=l=>{const t=String(l||'').replace(/\u00a0/g,' ').trim();
    return t.length>0&&t.length<=60&&!/[.;:]$/.test(t)&&!/\|/.test(t)
      &&!/\u0003/.test(t)                 // marcador de outra tabela já montada
      &&/[A-Za-zÀ-ÿ0-9]/.test(t);};        // "----+----" (separador) não é rótulo
  for(let i=0;i<linhas.length;i++){
    const l=linhas[i];
    if(ehLinhaTabela(l))bufer.push(l);
    else if(bufer.length&&ehRotuloSecao(l)&&ehLinhaTabela(linhas[i+1]))bufer.push('\u0004'+l.trim());
    else{fecharBufer();saida.push(l);}
  }
  fecharBufer();
  return{texto:saida.join('\n'),tabelas};
}
// ===== FÓRMULAS DO TEC =====
// O professor às vezes cola a fórmula direto da fonte em sintaxe TeX crua
// (\mbox{...} \over \mbox{...}), e sem interpretar isso aparece cru na tela
// em vez da fração de verdade que o TEC mostra. As funções abaixo fazem um
// parser bem pequeno — só entende \mbox{}, \over, chaves e "=" — o
// suficiente pra essas fórmulas de índice contábil, sem precisar carregar
// uma lib de LaTeX inteira.
function escHtmlSimples(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function tecOverIndex(str){
  let depth=0;
  for(let i=0;i<str.length;i++){
    const c=str[i];
    if(c==='{')depth++;
    else if(c==='}')depth--;
    else if(depth===0&&str.slice(i,i+5)==='\\over')return i;
  }
  return-1;
}
function tecSplitTopEquals(str){
  let depth=0,parts=[],last=0;
  for(let i=0;i<str.length;i++){
    const c=str[i];
    if(c==='{')depth++;
    else if(c==='}')depth--;
    else if(c==='='&&depth===0){parts.push(str.slice(last,i));last=i+1;}
  }
  parts.push(str.slice(last));
  return parts;
}
function tecStripOuterBraces(str){
  str=str.trim();
  while(str.startsWith('{')&&str.endsWith('}')){
    let depth=0,ok=true;
    for(let i=0;i<str.length;i++){
      if(str[i]==='{')depth++;
      else if(str[i]==='}'){depth--;if(depth===0&&i!==str.length-1){ok=false;break;}}
    }
    if(!ok)break;
    str=str.slice(1,-1).trim();
  }
  return str;
}
function parseFormulaTermTec(str){
  str=tecStripOuterBraces(str);
  const overIdx=tecOverIndex(str);
  if(overIdx>=0){
    const num=str.slice(0,overIdx);
    const den=str.slice(overIdx+5);
    return'<span class="tecfrac"><span class="tecfrac-num">'+parseFormulaTermTec(num)+'</span><span class="tecfrac-den">'+parseFormulaTermTec(den)+'</span></span>';
  }
  const mboxMatch=str.match(/^\\mbox\s*\{([^{}]*)\}$/);
  if(mboxMatch)return'<span class="tecfrac-text">'+escHtmlSimples(mboxMatch[1])+'</span>';
  // Sobrou algo fora do padrão \mbox{}/\over — mostra limpando as barras, pra
  // nunca deixar um "\mbox{" cru na tela mesmo se a fórmula fugir do molde.
  return'<span class="tecfrac-text">'+escHtmlSimples(str.replace(/\\mbox\s*\{([^{}]*)\}/g,'$1'))+'</span>';
}
function renderFormulaTec(raw){
  const partes=tecSplitTopEquals(raw.trim()).map(p=>p.trim()).filter(Boolean);
  const html=partes.map(parseFormulaTermTec).join('<span class="tecfrac-eq">=</span>');
  return'<div class="tecfrac-block">'+html+'</div>';
}
// Só converte um parágrafo inteiro quando ele é PURAMENTE fórmula — ou seja,
// depois de remover todo \mbox{...} e \over, só sobra chaves/=/espaço. Isso
// evita pegar um parágrafo comum que por acaso cite a palavra "over" ou tenha
// chaves soltas no meio do texto normal.
function extrairFormulasTec(texto){
  const formulas=[];
  const blocos=String(texto).split(/\n{2,}/);
  const out=blocos.map(bloco=>{
    const t=bloco.trim();
    if(!t||!/\\mbox\s*\{/.test(t))return bloco;
    const sobra=t.replace(/\\mbox\s*\{[^{}]*\}/g,'').replace(/\\over/g,'');
    if(!/^[\s{}=]*$/.test(sobra))return bloco;
    formulas.push(renderFormulaTec(t));
    return'\u0005FORM'+(formulas.length-1)+'\u0005';
  });
  return{texto:out.join('\n\n'),formulas};
}
function formatQuestionText(text){
  if(!text)return'';
  const{texto:semCodigo,blocos:blocosCodigo}=extrairBlocosDeCodigo(text);
  const{texto:comMarcasTbl,tabelas}=extrairTabelasComoHtml(semCodigo);
  const{texto:comFormulas,formulas}=extrairFormulasTec(comMarcasTbl);
  let esc=String(comFormulas).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  esc=desenharImagensDaQuestao(esc);
  // ===== MARKDOWN QUE FALTAVA =====
  // O comentário do TEC usa marcações que o renderizador ignorava, e marcação
  // ignorada não some: aparece crua. O "~~" era o pior, porque é justamente onde o
  // professor mostra o que o item trocou — o trecho errado riscado e o certo ao
  // lado. Sem interpretar, virava "~~vinte e cinco por cento~~ 30%", que é mais
  // difícil de ler do que o texto sem correção nenhuma.
  //
  // Linha só de --- ou *** é separador de seção; vira um filete discreto em vez de
  // três hifens soltos no meio do texto.
  esc=esc.replace(/^[ \t]*[-*_]{3,}[ \t]*$/gm,'\u0001HR\u0001');
  // Citação de lei ("> Art. 354...") — o ">" já virou &gt; no escape. Marca as
  // linhas para depois envolver num bloco recuado, em vez de deixar o sinal cru.
  esc=esc.replace(/^[ \t]*&gt;[ \t]?/gm,'\u0001CIT\u0001');
  // Texto importado de PDF costuma trazer uma quebra de linha a cada linha visual
  // do documento original (quebra de "wrap"), não só nos parágrafos de verdade.
  // Se toda quebra virasse <br><br> igualzinho, uma frase corrida que só estava
  // quebrada por causa da largura da página no PDF aparecia como um parágrafo
  // novo a cada pedaço — daí o espaçamento gigante em enunciados de texto corrido
  // (sem tabela). Por isso: só uma linha em branco de verdade (2+ quebras
  // seguidas, ou uma "linha vazia" que só tem um nbsp de espaçador) vira parágrafo
  // novo; uma quebra solta vira apenas um espaço, juntando a frase de novo.
  esc=esc.replace(/\n[ \t\u00A0]+\n/g,'\n\n');
  esc=esc.replace(/\n{2,}/g,'\u0001PARA\u0001');
  esc=esc.replace(/\n/g,' ');
  esc=esc.replace(/\u0001PARA\u0001/g,'<br><br>');
  esc=esc.replace(/ {2,}/g,' ');
  // As questões importadas do TecConcursos vêm em markdown. Convertido DEPOIS do
  // escape, então continua sendo texto seguro — só o negrito volta a ser negrito.
  esc=esc.replace(/\*\*([^*]{1,400}?)\*\*/g,'<strong>$1</strong>');
  esc=esc.replace(/(^|[^*])\*([^*\n]{1,200}?)\*(?!\*)/g,'$1<em>$2</em>');
  esc=esc.replace(/~~(?=[^~]*?[A-Za-zÀ-ú0-9]{2})([^~\\{}]{1,400}?)~~/g,'<s class="md-riscado">$1</s>');   // (sem \ nem chaves: ~~ dentro de fórmula LaTeX é espaço)
    // trecho que o item errou
  esc=esc.replace(/==([^=]{1,300}?)==/g,'<mark class="md-marca">$1</mark>'); // grifo do professor
  // Um separador já é espaço visual; o <br><br> grudado nele dobrava o buraco.
  esc=esc.replace(/(?:<br>){1,2}\u0001HR\u0001(?:<br>){1,2}/g,'\u0001HR\u0001');
  esc=esc.replace(/\u0001HR\u0001/g,'<span class="md-sep"></span>');
  // Cada trecho citado vira um bloco recuado. Linhas de citação seguidas caem no
  // mesmo bloco — por isso as marcas internas são limpas dentro do corpo capturado,
  // senão o sentinela aparecia cru na tela no meio da lei.
  esc=esc.replace(/\u0001CIT\u0001([\s\S]*?)(?=<br><br>|<span class="md-sep">|$)/g,
                  (m,corpo)=>'<span class="md-cit">'+corpo.replace(/\u0001CIT\u0001/g,'')+'</span>');
  esc=esc.replace(/\u0001CIT\u0001/g,'');   // rede de segurança: nenhuma marca escapa
  // ===== QUEBRA DE LINHA EM ITENS NUMERADOS (1. 2. 3...) OU ROMANOS (I. II. III...) =====
  // Versão antiga: exigia MAIÚSCULA logo depois do ponto (ex.: "I. Regulamentar"),
  // e só quebrava os romanos se o MESMO enunciado também tivesse "1.","2." arábicos.
  // Duas falhas: (1) item de lista que continua a frase em minúscula — comum em
  // questões tipo "...denominada tabela1, I. o menor valor..., II. um padrão..." —
  // nunca quebrava porque a palavra seguinte não é maiúscula; (2) um enunciado só
  // com romanos (sem nenhum arábico) nunca disparava a quebra dos romanos.
  // Correção: em vez de checar a letra seguinte ou cruzar as duas contagens, valida
  // pela SEQUÊNCIA em si — só quebra quando os números capturados formam uma
  // sequência crescente de 1 em 1 começando em 1/I (1,2,3... ou I,II,III...), que é
  // o sinal mais confiável de "isto é uma lista de itens" e evita falso positivo em
  // coisas soltas no meio do texto (ex.: "V. Exa." ou "art. 5.").
  function romanParaInt(s){
    const map={I:1,V:5,X:10,L:50,C:100,D:500,M:1000};
    let v=0;
    for(let i=0;i<s.length;i++){
      const cur=map[s[i]],prox=map[s[i+1]];
      v+=(prox>cur)?-cur:cur;
    }
    return v;
  }
  function quebrarListaSequencial(texto,regex,paraNumero){
    const candidatos=[...texto.matchAll(regex)];
    let prev=0,validos=new Set();
    for(const m of candidatos){
      const val=paraNumero(m[1]);
      if(val===prev+1){validos.add(m.index);prev=val;}
    }
    if(validos.size<2)return texto;
    let out='',last=0;
    for(const m of candidatos){
      if(!validos.has(m.index))continue;
      out+=texto.slice(last,m.index);
      // Item que já começa um parágrafo (ou o texto) não ganha outra quebra — senão
      // o espaço entre os itens dobrava.
      const jaQuebrado=m.index===0||/(?:<br>\s*)$/.test(out);
      out+=(jaQuebrado?'':'<br><br>')+'<strong>'+m[1]+'.</strong>';
      last=m.index+m[0].length;
    }
    out+=texto.slice(last);
    return out;
  }
  esc=quebrarListaSequencial(esc,/(?<=\s|^|<br>)(?:<strong>)?(\d{1,2})\.(?:<\/strong>)?(?=\s)/g,Number);
  esc=quebrarListaSequencial(esc,/(?<=\s|^|<br>)(?:<strong>)?([IVXLCDM]{1,4})\.(?:<\/strong>)?(?=\s)/g,romanParaInt);
  esc=esc.replace(/\u0003TBL(\d+)\u0003/g,(m,i)=>tabelas[+i]||'');
  esc=esc.replace(/\u0004COD(\d+)\u0004/g,(m,i)=>blocosCodigo[+i]||'');
  esc=esc.replace(/(?:<br>){0,2}\u0005FORM(\d+)\u0005(?:<br>){0,2}/g,(m,i)=>formulas[+i]||'');
  return esc;
}

// GERENCIAMENTO DE MATÉRIAS/CHIPS
const DEFAULT_CHIPS=[{label:'Tributário',value:'Direito Tributário'},{label:'Adm.',value:'Direito Administrativo'},{label:'Contabil.',value:'Contabilidade'},{label:'Leg. Fiscal',value:'Legislação Fiscal'},{label:'Auditoria',value:'Auditoria Privada'}];
function getCustomChips(){try{return JSON.parse(localStorage.getItem('questia_custom_chips')||'[]');}catch(e){return[];}}
function saveCustomChips(arr){localStorage.setItem('questia_custom_chips',JSON.stringify(arr));}
function renderMateriaChips(){
  const wrap=document.getElementById('materia-chips-wrap');if(!wrap)return;
  const custom=getCustomChips();
  const defaultHtml=DEFAULT_CHIPS.map(c=>`<button class="chip" onclick="setMateria(this,&#39;${c.value.replace(/'/g,"&#39;")}&#39;)">${c.label}</button>`).join('');
  const customHtml=custom.map((c,i)=>`<button class="chip chip-custom" onclick="setMateria(this,&#39;${c.replace(/'/g,"&#39;")}&#39;)">${c}<span onclick="event.stopPropagation();removeCustomChip(${i})" style="margin-left:6px;opacity:.6;font-weight:700">×</span></button>`).join('');
  wrap.innerHTML=defaultHtml+customHtml+`<button class="chip" onclick="addCustomMateria()" style="border-style:dashed">+ Nova matéria</button>`;
}
function addCustomMateria(){
  const nome=prompt("Nome da nova matéria (ex: Análise de DC's):");
  if(!nome||!nome.trim())return;
  const v=nome.trim();
  const custom=getCustomChips();
  if(!custom.includes(v)){custom.push(v);saveCustomChips(custom);}
  renderMateriaChips();
  updateMateriaDatalist();
  document.getElementById('inp-materia').value=v;
  document.querySelectorAll('.chip').forEach(c=>c.classList.remove('active'));
  notify('Matéria "'+v+'" adicionada!','ok');
}
function removeCustomChip(i){
  const custom=getCustomChips();
  custom.splice(i,1);
  saveCustomChips(custom);
  renderMateriaChips();
  updateMateriaDatalist();
}
function updateMateriaDatalist(){
  const dl=document.getElementById('materias-datalist');if(!dl)return;
  const fromBank=questions.map(q=>(q.materia||'').trim()).filter(Boolean);
  const fromChips=[...DEFAULT_CHIPS.map(c=>c.value),...getCustomChips()];
  const all=[...new Set([...fromBank,...fromChips])].sort();
  dl.innerHTML=all.map(m=>`<option value="${m.replace(/"/g,'&quot;')}">`).join('');
}

// API KEY
// Dois modos de falar com a IA:
//  1) CHAVE NO NAVEGADOR (sk-ant-...): chamada direta à Anthropic, como sempre foi.
//  2) SENHA DO SERVIDOR (qualquer outro texto): o site publicado no Netlify guarda a
//     chave numa variável de ambiente e a função /api/claude faz a chamada. A chave
//     nunca chega ao navegador; quem tiver só o link do site, sem a senha, não usa a IA.
// O mesmo campo aceita as duas coisas — o formato diz qual é.
function getChaveDireta(){try{return localStorage.getItem('questia_apikey')||'';}catch(e){return'';}}
function getSenhaServidor(){try{return localStorage.getItem('questia_senha_servidor')||'';}catch(e){return'';}}
// Continua com o mesmo nome porque o resto do app só pergunta "a IA está configurada?"
function getApiKey(){return getChaveDireta()||getSenhaServidor();}
function loadApiKey(){
  const k=getChaveDireta(),sv=getSenhaServidor(),el=document.getElementById('apikey-input');
  if(k||sv){
    el.value=k||sv;
    document.getElementById('apikey-banner').classList.add('ok');
    document.getElementById('apikey-hint').textContent=k
      ?'✓ Chave configurada neste navegador. Clique em Salvar para alterar.'
      :'✓ Usando a chave guardada no servidor (senha configurada). Clique em Salvar para alterar.';
  }
  return k||sv;
}
function saveApiKey(){
  const v=document.getElementById('apikey-input').value.trim();
  if(!v){
    try{localStorage.removeItem('questia_apikey');localStorage.removeItem('questia_senha_servidor');}catch(e){}
    document.getElementById('apikey-banner').classList.remove('ok');
    document.getElementById('apikey-hint').textContent='Chave removida deste navegador.';
    notify('Chave removida','ok');return;
  }
  try{
    if(v.startsWith('sk-ant-')){localStorage.setItem('questia_apikey',v);localStorage.removeItem('questia_senha_servidor');}
    else{
      if(location.protocol==='file:'){notify('Senha do servidor só funciona no site publicado. Aberto como arquivo, use a chave sk-ant-...','err');return;}
      localStorage.setItem('questia_senha_servidor',v);localStorage.removeItem('questia_apikey');
    }
  }catch(e){notify('Não consegui salvar: '+e.message,'err');return;}
  document.getElementById('apikey-banner').classList.add('ok');
  document.getElementById('apikey-hint').textContent=v.startsWith('sk-ant-')
    ?'✓ Chave salva neste navegador! Agora você pode gerar questões.'
    :'✓ Senha salva — a IA vai usar a chave guardada no servidor.';
  notify(v.startsWith('sk-ant-')?'API Key salva!':'Senha do servidor salva!','ok');
}
// Única porta de saída para a IA. Recebe o corpo da requisição da Messages API e
// devolve a Response, igual ao fetch fazia — quem chama não precisa saber o modo.
async function chamarClaude(corpo){
  const chave=getChaveDireta();
  if(chave){
    return fetch('https://api.anthropic.com/v1/messages',{method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':chave,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
      body:JSON.stringify(corpo)});
  }
  const senha=getSenhaServidor();
  if(!senha)throw new Error('Configure a chave da Anthropic ou a senha do servidor no topo da tela');
  const res=await fetch('/api/claude',{method:'POST',
    headers:{'Content-Type':'application/json','x-questia-senha':senha},
    body:JSON.stringify(corpo)});
  // Sem a função publicada, o servidor devolve uma página HTML de 404 — que o
  // chamador tentaria ler como JSON e mostraria um erro incompreensível.
  if(res.status===404||!(res.headers.get('content-type')||'').includes('json')){
    return new Response(JSON.stringify({error:{message:'O servidor deste site não tem a função /api/claude. Ela só existe no site publicado pelo Netlify; aberto de outro jeito, use a chave sk-ant-... no campo do topo.'}}),
      {status:502,headers:{'Content-Type':'application/json'}});
  }
  return res;
}

// ===== MODELO =====
// Estava fixo no código. Identificador de modelo é data de validade: quando a versão
// é aposentada, a API passa a responder 404 e o gerador simplesmente para — com uma
// mensagem que não diz o que houve. Agora é configurável e o erro explica o caminho.
const MODELO_PADRAO='claude-sonnet-5-5';
const MODELOS_SUGERIDOS=['claude-sonnet-5-5','claude-opus-5-5','claude-haiku-4-5-20251001'];
function getModelo(){try{return (localStorage.getItem('questia_modelo')||'').trim()||MODELO_PADRAO;}catch(e){return MODELO_PADRAO;}}
function salvarModelo(){
  const v=(document.getElementById('modelo-input').value||'').trim();
  try{
    if(v)localStorage.setItem('questia_modelo',v);
    else{localStorage.removeItem('questia_modelo');document.getElementById('modelo-input').value=MODELO_PADRAO;}
  }catch(e){}
  notify('Modelo: '+getModelo(),'ok');
}
function carregarModelo(){
  const el=document.getElementById('modelo-input');if(!el)return;
  el.value=getModelo();
  const dl=document.getElementById('modelos-datalist');
  if(dl)dl.innerHTML=[...new Set([...MODELOS_SUGERIDOS,getModelo()])].map(m=>`<option value="${esc(m)}">`).join('');
}

// ===== PREFERÊNCIAS DO GERADOR =====
// Banca, formato, dificuldade e foco passam a ser lembrados. O padrão vinha fixo em
// CESPE enquanto o alvo é FCC — trocar o seletor a cada geração era atrito diário.
const PREFS_PADRAO={banca:'FCC',formato:'multipla',dific:'médio',foco:'literal'};
function salvarPrefsGerador(){
  const p={
    banca:(document.getElementById('sel-banca')||{}).value||PREFS_PADRAO.banca,
    formato:(document.getElementById('sel-formato')||{}).value||PREFS_PADRAO.formato,
    dific:(document.getElementById('sel-dific')||{}).value||PREFS_PADRAO.dific,
    foco:(document.getElementById('sel-foco')||{}).value||PREFS_PADRAO.foco,
  };
  try{localStorage.setItem('questia_prefs_gerador',JSON.stringify(p));}catch(e){}
}
function carregarPrefsGerador(){
  let p=PREFS_PADRAO;
  try{p=Object.assign({},PREFS_PADRAO,JSON.parse(localStorage.getItem('questia_prefs_gerador')||'{}'));}catch(e){}
  const põe=(id,v)=>{const el=document.getElementById(id);if(el&&[...el.options].some(o=>o.value===v))el.value=v;};
  põe('sel-banca',p.banca);põe('sel-formato',p.formato);põe('sel-dific',p.dific);põe('sel-foco',p.foco);
}

// SM-2
function fmtNextDue(nextDue){
  if(!nextDue) return 'hoje';
  const today2=new Date(); today2.setHours(0,0,0,0);
  const due=new Date(nextDue+'T00:00:00');
  const diff=Math.round((due-today2)/(1000*60*60*24));
  if(diff<=0) return 'hoje';
  if(diff===1) return 'amanhã';
  if(diff<30) return `em ${diff} dias`;
  if(diff<365) return `em ${Math.round(diff/30)} meses`;
  return `em ${Math.round(diff/365)} ano(s)`;
}

// ===== AGENDAMENTO — curva do Anki (SM-2 do scheduler v2/v3) =====
// Fórmulas idênticas às do Anki. O que muda é o INTERVAL MODIFIER (`im`), que no Anki
// vem em 100% e aqui vem em 120% para espaçar um pouco mais, e o tratamento do lapso.
//
//   Errei    ease -0,20  ·  intervalo × lapsoPct     (Anki: 0%; aqui 30%, com teto)
//   Difícil  ease -0,15  ·  intervalo × 1,20 × im
//   Bom      ease  0,00  ·  intervalo × ease × im
//   Fácil    ease +0,15  ·  intervalo × ease × 1,30 × im
//   Piso: todo acerto rende pelo menos intervalo anterior + 1 dia (regra do Anki).
const SCHED_PADRAO={
  im:1.20,                            // Interval Modifier. 1,00 = Anki puro. >1 espaça mais.
  easeMin:1.30,                       // idêntico ao Anki
  deltaEase:[-0.20,-0.15,0.00,0.15,0.25],  // Errei, Difícil, Bom, Fácil (idênticos ao Anki) + Dominada
  fatorDificil:1.20,                  // "Hard interval" do Anki
  bonusFacil:1.30,                    // "Easy bonus" do Anki
  bonusDominio:2.10,                  // nota "Dominada": ~1,6× o salto do Fácil. Existe porque em
                                      // pós-edital repetir o que você já domina custa dia de estudo,
                                      // e o Fácil sozinho ainda devolve a questão cedo demais
  entrada:[null,2,4,6,21],            // substitui os learning steps do Anki (que são intradiários);
                                      // o 21 é a 1ª revisão de uma questão nunca respondida que você
                                      // já marcou como dominada — pula o aquecimento curto inteiro
  lapsoPct:0.30, lapsoTeto:21,        // Anki zera (0%); aqui encurta para 30%, no máx. 21 dias
  fuzz:0.05,                          // ±5%: o mesmo truque do Anki para as revisões não se amontoarem
  tetoDias:365,
  limiteDiario:60,                    // teto de revisões por dia (0 = sem limite)
  cotaNovas:0.40,                     // fatia do dia reservada a questões de banca ainda não respondidas
  leechLimite:5                       // nº de erros que marca a questão como "leech"
};
function schedCfg(fonte){
  const c=schedCfgBruto();
  const n=diasAteProva();
  // O teto e o espaçamento da reta final valem só para as questões dentro do escopo.
  // Fora dele, a questão segue exatamente o agendamento que você configurou.
  if(n!==null&&n>0&&retaAlcanca(fonte)){
    c.tetoDias=Math.min(c.tetoDias,tetoRetaFinal(n));
    c.im=Math.min(c.im,1.00);
  }
  return c;
}
function salvarSchedCfg(c){localStorage.setItem('questia_sched',JSON.stringify(c));}

// semFuzz=true devolve o valor limpo, usado nos rótulos dos botões e na prévia do painel
// Sob o teto da reta final, as notas se espalham entre a espera do erro e o teto:
// Difícil a 1/3 do caminho, Bom a 2/3, Fácil e Dominada no teto.
const FRACAO_SOB_TETO=[null,1/3,2/3,1,1];
const ERRO_VOLTA_MIN=2, ERRO_VOLTA_MAX=3;
function sm2(q,reps,ef,interval,semFuzz,fonte){
  // q: 0=Errei, 1=Difícil, 2=Bom, 3=Fácil, 4=Dominada
  const cfg=schedCfg(fonte);
  const anterior=Math.max(0,interval||0);
  const ef0=ef||2.5;
  ef=Math.max(cfg.easeMin,ef0+cfg.deltaEase[q]);
  let base,piso;
  if(q===0){
    base=Math.max(1,Math.min(Math.round(anterior*cfg.lapsoPct),cfg.lapsoTeto));
    piso=1;
    reps=Math.max(0,reps-1); // não zera: perder a escada inteira por 1 erro era o que entupia a fila
    // Na reta final o erro de uma questão madura não pode voltar DEPOIS do Difícil
    // (antes: intervalo 36 → Errei 11 dias, Difícil espalhado em 8). Volta na espera do erro.
    {const n=diasAteProva();if(n!==null&&n>0&&retaAlcanca(fonte)&&anterior*cfg.fatorDificil*cfg.im>cfg.tetoDias)base=Math.min(base,Math.max(1,Math.min(QUAL_ERRO_ESPERA,cfg.tetoDias)));}
    base=Math.min(Math.max(base,ERRO_VOLTA_MIN),ERRO_VOLTA_MAX); // errou: volta em 2 a 3 dias (1 dia = ainda lembra da resposta de ontem; 4+ = já esqueceu)
  } else if(reps===0||anterior===0){
    base=cfg.entrada[q];piso=1;reps=1;
  } else {
    const bruto=q===1?anterior*cfg.fatorDificil*cfg.im
              :q===2?anterior*ef*cfg.im
              :q===3?anterior*ef*cfg.bonusFacil*cfg.im
                    :anterior*ef*cfg.bonusDominio*cfg.im;
    // Regra do Anki: acerto nunca encurta o intervalo. MAS o teto manda mais que
    // ela — senão a reta final não puxa de volta nada do que já passou do teto.
    // Sem o Math.min, uma questão com intervalo 200 e teto 15 saía com 201: o
    // base era cortado para 15, e o aplicarFuzz devolvia Math.max(piso,...) = 201.
    // Resultado: o teto da reta final só valia para quem já estava abaixo dele, e
    // o rótulo do botão (calculado com semFuzz) prometia 15 enquanto o app
    // agendava 201.
    piso=Math.min(anterior+1,cfg.tetoDias);
    base=Math.max(piso,Math.round(bruto));
    // Escalonamento sob o teto: quando o intervalo natural passa do teto (reta final
    // com questão madura), cortar tudo no teto deixava Difícil, Bom, Fácil e Dominada
    // idênticos — a nota não mudava nada. Aí cada nota ganha uma fração do teto
    // (Difícil ½ · Bom ¾ · Fácil e Dominada = teto), sem nunca ficar abaixo da nota
    // anterior. Intervalos que cabem no teto seguem exatamente a fórmula de sempre.
    if(base>cfg.tetoDias){
      const natural=qq=>{const e=Math.max(cfg.easeMin,ef0+cfg.deltaEase[qq]);
        const b=qq===1?anterior*cfg.fatorDificil*cfg.im:qq===2?anterior*e*cfg.im
               :qq===3?anterior*e*cfg.bonusFacil*cfg.im:anterior*e*cfg.bonusDominio*cfg.im;
        return Math.max(anterior+1,Math.round(b));};
      let alvo=0;
      for(let qq=1;qq<=q;qq++){
        const v=natural(qq);
        const E=Math.min(QUAL_ERRO_ESPERA,cfg.tetoDias);
        alvo=v<=cfg.tetoDias?v:Math.max(alvo,Math.max(1,Math.round(E+(cfg.tetoDias-E)*FRACAO_SOB_TETO[qq])));
      }
      base=Math.min(alvo,cfg.tetoDias);
      piso=1;
    }
    reps++;
  }
  base=Math.min(base,cfg.tetoDias);
  const final=semFuzz?base:aplicarFuzz(base,piso,cfg);
  const d=new Date();d.setDate(d.getDate()+final);
  return{reps,ef,interval:final,intervalBase:base,nextDue:ymd(d)};
}
// Sem fuzz, 222 questões respondidas no mesmo dia com a mesma nota voltariam todas
// no mesmo dia, para sempre. O Anki espalha por isso.
function aplicarFuzz(iv,piso,cfg){
  if(iv<5||!cfg.fuzz)return iv;
  const amp=Math.max(1,Math.round(iv*cfg.fuzz));
  const j=iv+Math.round((Math.random()*2-1)*amp);
  return Math.max(piso,Math.min(j,cfg.tetoDias));
}
// Data AAAA-MM-DD no fuso LOCAL. toISOString() converte para UTC — em São Paulo
// (UTC-3) isso empurrava em +1 dia todo intervalo calculado depois das 21h.
function ymd(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function today(){return ymd(new Date());}
// ===== MATÉRIAS PAUSADAS =====
// Pausa temporária de uma matéria inteira (ex.: Inglês até a reta final). Diferente
// de suspender: não marca questão nenhuma, então reativar devolve tudo exatamente
// como estava — inclusive questões que você tinha suspendido uma a uma continuam
// suspensas. A lista fica salva e vai junto no backup.
const CHAVE_PAUSADAS='questia_materias_pausadas';
let cachePausadas=null;
function materiasPausadas(){
  if(!cachePausadas){try{cachePausadas=new Set(JSON.parse(localStorage.getItem(CHAVE_PAUSADAS)||'[]'));}catch(e){cachePausadas=new Set();}}
  return cachePausadas;
}
function materiaPausada(q){const p=materiasPausadas();return p.size>0&&p.has((q.materia||'').trim());}
function salvarPausadas(set){cachePausadas=new Set(set);try{localStorage.setItem(CHAVE_PAUSADAS,JSON.stringify([...cachePausadas]));}catch(e){}}
function pausarMateriaFiltrada(){
  const m=estudarFiltroMateria();
  if(!m){notify('Escolha a matéria no filtro ao lado e clique de novo','err');return;}
  const n=questions.filter(q=>(q.materia||'').trim()===m).length;
  const p=materiasPausadas();p.add(m);salvarPausadas(p);
  document.getElementById('f-estudar-materia').value='';
  populateEstudarSubtemas();updateSidebar();initStudy();
  notify(`⏸ "${m}" pausada — ${n} questões fora da fila até você reativar`,'ok');
}
function reativarMateriaPausada(m){
  const p=materiasPausadas();p.delete(m);salvarPausadas(p);
  updateSidebar();initStudy();
  notify(`▶ "${m}" de volta à fila`,'ok');
}
function renderMateriasPausadas(){
  const el=document.getElementById('materias-pausadas');if(!el)return;
  const p=[...materiasPausadas()].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  if(!p.length){el.innerHTML='';return;}
  el.innerHTML='<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:12px;color:var(--muted)">Pausadas:'
    +p.map(m=>{const n=questions.filter(q=>(q.materia||'').trim()===m).length;
      return `<span class="tag" style="background:var(--indigo-light);color:var(--indigo-text);border:1px solid var(--indigo-border);display:inline-flex;gap:6px;align-items:center;text-transform:none;font-size:11px">⏸ ${esc(m)} · ${n}<button onclick="reativarMateriaPausada(${JSON.stringify(m).replace(/"/g,'&quot;')})" title="Reativar" style="background:none;border:none;cursor:pointer;color:inherit;font-weight:700;font-size:12px;padding:0">▶ reativar</button></span>`;}).join('')
    +'</div>';
}
function isDue(q){return!q.suspensa&&!materiaPausada(q)&&(!q.nextDue||q.nextDue<=today());}
function isLeech(q){return(q.erros||0)>=schedCfg().leechLimite;}
// Quantos dias a questão está vencida (negativo = ainda não venceu)
function diasAtraso(q){
  if(!q.nextDue)return 9999;
  return Math.round((new Date(today()+'T00:00:00')-new Date(q.nextDue+'T00:00:00'))/86400000);
}
function respondidasHoje(){
  const h=histCache[today()];return h?(h.ac||0)+(h.er||0):0;
}
// ===== SUBTEMA x ORIGEM =====
// O subtema é o NOME do conceito e serve para agrupar: filtro, estatística, fila.
// A origem é a procedência (QID, dispositivo, lote, o que foi mutado) e não entra
// em cálculo nenhum. Antes tudo ia junto no subtema, com média de 316 caracteres —
// e um campo onde cada valor é único não agrupa coisa alguma.
function separarOrigem(bruto){
  const s=String(bruto||'').replace(/\s+/g,' ').trim();
  if(!s)return{subtema:'',origem:''};
  if(s.length<=LIMITE_SUBTEMA)return{subtema:s.replace(/\.$/,''),origem:''};
  let m;
  if((m=s.match(/^(.{5,120}?)\.\s*Origem\/muta[çc][ãa]o:/)))            return{subtema:m[1].replace(/^Tema:\s*/,'').trim(),origem:s};
  if((m=s.match(/fragilidade:\s*F\d+\s*-\s*(.+?)\)\s*\./)))            return{subtema:m[1].trim(),origem:s};
  if((m=s.match(/^Bloco:\s*.*?\.\s*Tema:\s*(.*?)(?:\s*\.\s*(?:Dispositivo|Ancorada)\b.*)?$/))) return{subtema:m[1].replace(/\.$/,'').trim(),origem:s};
  if((m=s.match(/^Tema:\s*(.*?)(?:\s*\.\s*(?:Ancorada|Dispositivo|Muta[çc][ãa]o)\b.*)?$/)))    return{subtema:m[1].replace(/\.$/,'').trim(),origem:s};
  if((m=s.match(/fam[íi]lia de quest[õo]es sobre (.+?) do bloco/)))     return{subtema:m[1].trim(),origem:s};
  if((m=s.match(/Discriminador(?:\s+original)?(?:\s+explorado[^:]*)?:\s*(.*)$/))){
    const d=m[1].split(/\.?\s*Muta[çc][ãa]o:/)[0].trim().replace(/\.$/,'');
    return{subtema:d.length>LIMITE_SUBTEMA?d.slice(0,LIMITE_SUBTEMA-1)+'…':d,origem:s};
  }
  return{subtema:s.slice(0,LIMITE_SUBTEMA-1)+'…',origem:s};
}
function mkQ(data){
  const sep=data.origem!==undefined?{subtema:String(data.subtema||'').trim(),origem:String(data.origem||'')}:separarOrigem(data.subtema);
  const materia=(data.materia||'').trim();
  return{id:Date.now()+Math.random(),questao:data.questao||'',alternativas:data.alternativas||[],gabarito:data.gabarito??0,gabTexto:(data.alternativas||[])[data.gabarito??0]||'',comentario:data.comentario||data.gabarito_texto||'',subtema:sep.subtema,origem:sep.origem,materia,banca:(data.banca||'').trim(),reps:0,ef:2.5,interval:0,nextDue:today(),acertos:0,erros:0,favorita:false,consolidada:false,
  // Nasce suspensa se a matéria não bate com nada do EDITAL — evita ter que
  // caçar isso depois no painel de Meta. Reative manualmente se for engano.
  suspensa:materiaForaDoEdital(materia)};
}
// Escapa antes de qualquer innerHTML. Sem isto, um "<" vindo da IA ou de um .json
// importado quebra a renderização — e, no caso do .json, executa script.
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
// Para previews em texto puro (não passam por formatQuestionText): troca o marcador
// de imagem — que pode carregar um base64 enorme — por um rótulo curto.
function semMarcadorImg(s){return String(s||'').replace(/\[\[IMG:[^\]]*\]\]/g,'[imagem]').replace(/\[\[IMG-URL:[^\]]*\]\]/gi,'[imagem]').replace(/\[\[IMAGEM N[ÃA]O IMPORTADA\]\]/gi,'[imagem]');}

// NAV
function nav(page){document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));document.getElementById('page-'+page).classList.add('active');['gerar','banco','estudar','resumos','revisao','stats','meta','backup','ranking','dashboard'].forEach((p,i)=>{if(p===page)document.querySelectorAll('.nav-item')[i].classList.add('active');});if(page==='banco')renderBanco();if(page==='estudar')initStudy();if(page==='resumos')renderResumos();if(page==='revisao'){loadCards();document.getElementById('rev-meta-input').value=cfgRev().meta;document.getElementById('rev-erros-input').value=cfgRev().minErros;renderRevisao();}if(page==='stats'){
    renderStats();renderSchedCard();
    // Inicializar datas se ainda não definidas
    const toEl=document.getElementById('hist-to');
    const fromEl=document.getElementById('hist-from');
    if(!toEl.value){
      // Padrão: o dia de hoje. Os botões Hoje/7d/30d/90d mudam o período.
      toEl.value=today();
      fromEl.value=today();
      renderHistChart();
    } else { renderHistChart(); }
  }if(page==='meta')renderMeta();if(page==='backup'){renderBackupInfo();renderStatusLotePratica();}if(page==='ranking')renderRanking();if(page==='dashboard')renderDashboard();updateSidebar();}
function updateSidebar(){document.getElementById('sb-total').textContent=questions.length;const due=questions.filter(isDue).length;const b=document.getElementById('due-badge');if(due>0){b.style.display='inline';b.textContent=due;}else b.style.display='none';}

// FONTE
function switchFonte(t){document.querySelectorAll('.fonte-tab').forEach((b,i)=>b.classList.toggle('active',(i===0&&t==='texto')||(i===1&&t==='pdf')));document.getElementById('fonte-texto').style.display=t==='texto'?'block':'none';document.getElementById('fonte-pdf').style.display=t==='pdf'?'block':'none';}
document.getElementById('fonte-txt').addEventListener('input',updateCharCount);
function updateCharCount(){const n=document.getElementById('fonte-txt').value.length;document.getElementById('char-count').textContent=n.toLocaleString('pt-BR')+' caracteres';}
const dz=document.getElementById('drop-zone');
dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('drag-over');});
dz.addEventListener('dragleave',()=>dz.classList.remove('drag-over'));
dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('drag-over');if(e.dataTransfer.files[0])loadPDF({target:{files:e.dataTransfer.files}});});
async function loadPDF(event){const file=event.target.files[0];if(!file)return;showLoading('Extraindo texto do PDF...','Processando o documento');try{if(!window.pdfjsLib){await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';}const ab=await file.arrayBuffer();const pdf=await pdfjsLib.getDocument({data:ab}).promise;let text='';const maxP=Math.min(pdf.numPages,30);for(let i=1;i<=maxP;i++){const page=await pdf.getPage(i);const c=await page.getTextContent();text+=c.items.map(x=>x.str).join(' ')+'\n';}pdfText=text.trim();document.getElementById('pdf-name').textContent=file.name;document.getElementById('pdf-pages').textContent=`${pdf.numPages} pág. · ${pdfText.length.toLocaleString('pt-BR')} chars`;document.getElementById('pdf-loaded').classList.add('show');document.getElementById('drop-zone').style.display='none';hideLoading();notify('PDF carregado!','ok');}catch(e){hideLoading();notify('Erro ao ler PDF: '+e.message,'err');}}
function clearPDF(){pdfText='';document.getElementById('pdf-loaded').classList.remove('show');document.getElementById('drop-zone').style.display='block';document.getElementById('pdf-input').value='';}
function loadScript(src){return new Promise((res,rej)=>{const s=document.createElement('script');s.src=src;s.onload=res;s.onerror=rej;document.head.appendChild(s);});}

// CONFIG
function changeNum(d){numQuestoes=Math.max(1,Math.min(30,numQuestoes+d));document.getElementById('num-val').textContent=numQuestoes;}
function setMateria(el,val){document.querySelectorAll('.chip').forEach(c=>c.classList.remove('active'));el.classList.add('active');document.getElementById('inp-materia').value=val;}

// GERAR
async function gerarQuestoes(){
  const apiKey=getApiKey();if(!apiKey){notify('Configure sua API Key primeiro!','err');return;}
  const fonte=document.getElementById('fonte-txt').value.trim()||pdfText;
  if(!fonte){notify('Cole um texto ou carregue um PDF primeiro','err');return;}
  if(fonte.length<80){notify('Conteúdo muito curto.','err');return;}
  const banca=document.getElementById('sel-banca').value;
  const formato=(document.getElementById('sel-formato')||{value:'multipla'}).value;
  const dific=document.getElementById('sel-dific').value;
  const materia=document.getElementById('inp-materia').value.trim()||'Área Fiscal';
  const foco=document.getElementById('sel-foco').value;
  // ANTI-REPETIÇÃO: manda para o modelo o que JÁ existe no banco desta matéria.
  // Antes, a regra de variedade valia só dentro da mesma rodada — gerar 2x do mesmo
  // PDF devolvia quase-clones porque o modelo não via o histórico.
  const doBanco=questions.filter(q=>!q.materia||!materia||q.materia.toLowerCase()===materia.toLowerCase());
  // Só conceitos curtos entram no bloco anti-repetição. Antes ia o subtema inteiro:
  // com uma média de 316 caracteres, 80 deles somavam ~25 mil caracteres de prompt,
  // quase tudo repetição de "Ancorada em...", "Discriminador original:", "Lote 3, Bloco E".
  // A IA se afogava no ruído em vez de enxergar os conceitos que devia evitar.
  const subtemasBanco=[...new Set(doBanco.map(q=>(q.subtema||'').trim()).filter(Boolean)
      .map(s=>s.length>LIMITE_SUBTEMA?s.slice(0,LIMITE_SUBTEMA)+'…':s))].slice(-80);
  const blocoAntiRepeticao=subtemasBanco.length?`
10. NÃO REPETIR O BANCO — regra crítica:
   Os conceitos abaixo JÁ foram cobrados em questões salvas de "${materia}". É PROIBIDO elaborar questão cujo ponto central seja qualquer um deles:
   ${subtemasBanco.map(s=>'- '+s).join('\n   ')}
   Se o conteúdo-fonte só tiver conceitos já listados, mude o ÂNGULO (exceção em vez de regra, prazo, competência do ente, efeito prático, hipótese de afastamento) e deixe o ângulo explícito no campo "subtema".`:'';

  showLoading('Gerando questões...',`${numQuestoes} questões · ${banca} · ${dific}`);
  const system=`Você é um elaborador especialista de questões para concursos públicos fiscais brasileiros. Especialidade: ${banca}. Responda SEMPRE com JSON válido e nada mais.`;
  // O formato muda o que a IA deve produzir e quanto custa gerar. Certo/Errado tem
  // duas alternativas fixas, e o código de estudo já as detecta para não embaralhar
  // (com 2 opções o embaralho não evita decoreba, só desalinha o rótulo A/B).
  const instrFormato = formato==='certo-errado'
    ? `Elabore EXATAMENTE ${numQuestoes} itens de julgamento CERTO ou ERRADO.
   - Cada item tem EXATAMENTE duas alternativas, sempre nesta ordem: ["Certo","Errado"].
   - gabarito = 0 quando a afirmação está CERTA, 1 quando está ERRADA.
   - A afirmação vai inteira no campo "questao". Não numere, não escreva "Julgue o item".
   - Aproximadamente metade dos itens CERTOS e metade ERRADOS, sem padrão previsível.`
    : formato==='misto'
    ? `Elabore EXATAMENTE ${numQuestoes} questões, MISTURANDO os dois formatos (cerca de metade de cada):
   - Formato A — múltipla escolha: 5 alternativas ["A) ...","B) ...", ... ,"E) ..."], gabarito de 0 a 4.
   - Formato B — certo/errado: exatamente ["Certo","Errado"], gabarito 0 (certa) ou 1 (errada), com a afirmação inteira em "questao".`
    : `Elabore EXATAMENTE ${numQuestoes} questões de múltipla escolha (A a E).`;

  const prompt=`${instrFormato}

CONTEÚDO:
"""
${fonte.substring(0,7000)}
"""

REGRAS:
1. Estilo ${banca}: redação técnica formal.
2. VARIEDADE DE SUBTEMAS — regra crítica:
   - Identifique TODOS os subtemas/conceitos presentes no conteúdo acima.
   - Distribua as ${numQuestoes} questões entre o MÁXIMO de subtemas diferentes possível.
   - PROIBIDO gerar 2 ou mais questões sobre o mesmo conceito específico na mesma rodada.
   - Se o conteúdo tiver menos subtemas do que questões solicitadas, aprofunde o mesmo subtema em ângulos diferentes (ex: regra geral, exceção, caso prático).
3. ALTERNATIVAS — regras críticas${formato==='certo-errado'?' (valem para a AFIRMAÇÃO do item)':''}:
   - PROIBIDO citar artigos, incisos ou parágrafos de lei nas alternativas (ex: "art. 150", "§2", "inciso III"). As alternativas devem afirmar CONCEITOS, não transcrever dispositivos.
   - PROIBIDO alternativas obviamente erradas ou absurdas.
   - Cada distrator deve enganar quem estudou superficialmente.
   - Use: troca de percentuais próximos, inversão sujeito/objeto, confusão exceção/regra, troca de prazos plausíveis, atribuição de competência ao ente errado.
4. ENUNCIADO: pode usar situação hipotética — mas sem transcrever artigos literalmente.
5. GABARITO: ${formato==='certo-errado'?'alterne CERTO e ERRADO sem padrão — máx 2 consecutivos iguais.':'distribuído entre A, B, C, D, E — máx 2 consecutivos iguais.'}
6. Dificuldade: ${dific}. Foco: ${foco}.
7. COMENTÁRIO: uma frase curta e direta explicando por que a alternativa correta está certa (conceito, sem citar artigo).
8. VALORES MONETÁRIOS E NUMÉRICOS: sempre use formatação brasileira — R$ 220.000,00 (ponto para milhar, vírgula para decimal). Nunca use formato americano (220,000.00). Nunca omita o símbolo R$ em valores monetários.
9. SUBTEMA — regra crítica de formato:
   - É o NOME do conceito cobrado, no MÁXIMO ${LIMITE_SUBTEMA} caracteres. Exemplos do tamanho certo: "Imunidade tributária recíproca", "Taxa — poder de polícia", "ICMS — substituição tributária".
   - PROIBIDO no subtema: frase explicativa, justificativa, número de QID, lote, bloco, artigo de lei, nome de arquivo, referência a questão anterior ou qualquer descrição do que foi mutado.
   - REUTILIZE o nome exato de um conceito já listado na regra 10 sempre que a questão cobrar aquele mesmo conceito. O subtema serve para AGRUPAR questões — se cada questão tiver um nome diferente, ele não agrupa nada e o filtro por subtema fica inútil.
10. ORIGEM: se quiser registrar procedência (QID, dispositivo legal, lote, o que foi mutado), use o campo "origem", NUNCA o "subtema". Esse campo é livre e não entra em filtro nem em estatística.
${blocoAntiRepeticao.replace('\n10.','\n11.')}

JSON PURO (sem markdown):
{"questoes":[{
  "questao":"Enunciado da questão...",
  "alternativas":${formato==='certo-errado'?'["Certo","Errado"]':'["A) ...","B) ...","C) ...","D) ...","E) ..."]'}${formato==='misto'?'   // ou exatamente ["Certo","Errado"] nos itens de julgamento':''},
  "gabarito":${formato==='certo-errado'?'0':'2'},
  "comentario":"Explicação direta de por que a alternativa correta está certa.",
  "subtema":"Nome curto do conceito (máx ${LIMITE_SUBTEMA} caracteres)",
  "origem":"Procedência opcional: QID, dispositivo, lote, o que foi mutado"
}]}

${formato==='certo-errado'?'gabarito=0 para Certo, 1 para Errado.'
 :formato==='misto'?'gabarito: nas de múltipla escolha é o índice 0=A,1=B,2=C,3=D,4=E; nas de certo/errado é 0 para Certo e 1 para Errado.'
 :'gabarito=índice 0=A,1=B,2=C,3=D,4=E.'} Matéria: ${materia}`;
  try{
    const res=await chamarClaude({model:getModelo(),max_tokens:Math.min(16000, numQuestoes * (formato==='certo-errado'?320:600)),system,messages:[{role:'user',content:prompt}]});
    if(!res.ok){const e=await res.json();throw new Error(e.error?.message||`HTTP ${res.status}`);}
    const data=await res.json();
    const raw=data.content.map(b=>b.text||'').join('');
    const clean=raw.replace(/```json|```/g,'').trim();
    let parsed;
    try {
      parsed=JSON.parse(clean);
    } catch(jsonErr) {
      // Try to salvage partial JSON — find last complete questao object
      const lastBrace=clean.lastIndexOf('}]}');
      const lastBrace2=clean.lastIndexOf('}]');
      const cutAt=lastBrace>=0?lastBrace+3:(lastBrace2>=0?lastBrace2+2:-1);
      if(cutAt>0) {
        try { parsed=JSON.parse(clean.substring(0,cutAt)); }
        catch(e2) { throw new Error('Resposta incompleta da IA. Tente gerar menos questões por vez (máx 3) ou tente novamente.'); }
      } else {
        throw new Error('Resposta incompleta da IA. Reduza o número de questões e tente novamente.');
      }
    }
    hideLoading();showResults(parsed.questoes||parsed,materia,banca);
  }catch(e){hideLoading();let msg=e.message;
    if(/not_found|404|model/i.test(msg)&&/model/i.test(msg))msg=`Modelo "${getModelo()}" não existe mais ou não está disponível na sua conta. Troque o identificador no campo 🤖 Modelo, no topo da tela.`;
    else if(msg.includes('401'))msg='API Key inválida ou expirada. Verifique em console.anthropic.com.';
    else if(msg.includes('429')||msg.toLowerCase().includes('rate'))msg='⏱ Limite por minuto atingido. Aguarde 1 minuto e tente novamente. Normal em contas novas.';
    else if(msg.includes('529')||msg.toLowerCase().includes('overload'))msg='Servidor sobrecarregado. Aguarde 30 segundos e tente novamente.';
    else if(msg.toLowerCase().includes('credit')||msg.toLowerCase().includes('billing'))msg='Saldo insuficiente. Adicione créditos em console.anthropic.com → Billing.';
    else if(msg.includes('fetch'))msg='Erro de conexão. Verifique sua internet.';
    notify('Erro: '+msg,'err');}
}

// DETECÇÃO DE QUESTÕES QUASE-IDÊNTICAS
const DUP_LIMIAR=0.50; // Jaccard sobre palavras de conteúdo
const STOPWORDS=new Set(('a o e de da do das dos que em no na nos nas um uma para por com ao aos as os se sua seu suas seus '+
  'ser sao esta este essa esse aquele aquela ou nao como mais menos pelo pela quando entre sobre sem apos ate qual quais '+
  'caso hipotese acerca respeito seguinte seguintes assinale alternativa correta incorreta julgue item texto').split(' '));
function normTokens(s){
  return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(w=>w.length>3&&!STOPWORDS.has(w));
}
// ===== IMPRESSÃO DIGITAL NUMÉRICA =====
// O tokenizador joga fora tokens de até 3 caracteres, e "R$ 25.000,00" vira
// "25","000","00" — todos descartados. Resultado: duas questões idênticas no texto
// mas com VALORES diferentes pontuavam similaridade 1,00 e eram acusadas de
// duplicata. No seu banco isso acontece em 9 dos 12 pares acima de 0,85.
// Questão de cálculo com números diferentes é outra questão, não cópia.
function impressaoNumerica(s){
  const m=String(s||'').match(/\d[\d.,]*\d|\d/g)||[];
  return m.map(x=>x.replace(/\./g,'').replace(',','.')).sort().join('|');
}
function mesmosNumeros(a,b){return impressaoNumerica(a)===impressaoNumerica(b);}
function similaridade(a,b){
  const A=new Set(normTokens(a)),B=new Set(normTokens(b));
  if(!A.size||!B.size)return 0;
  let inter=0;A.forEach(w=>{if(B.has(w))inter++;});
  return inter/(A.size+B.size-inter);
}
// Compara contra o banco salvo E contra as outras questões da mesma rodada
function checarDuplicata(q,lote,idx){
  const alvo=(q.questao||'')+' '+(q.subtema||'');
  const sub=(q.subtema||'').trim().toLowerCase();
  let pior={score:0,onde:'',ref:''};
  questions.forEach(ex=>{
    const s=similaridade(alvo,(ex.questao||'')+' '+(ex.subtema||''));
    if(s>pior.score&&mesmosNumeros(q.questao,ex.questao))
      pior={score:s,onde:'no banco',ref:ex.subtema||semMarcadorImg(ex.questao||'').slice(0,70)+'…'};
  });
  lote.forEach((ex,j)=>{
    if(j===idx)return;
    const s=similaridade(alvo,(ex.questao||'')+' '+(ex.subtema||''));
    if(s>pior.score&&mesmosNumeros(q.questao,ex.questao))
      pior={score:s,onde:'nesta rodada',ref:'questão '+(j+1)};
  });
  if(sub&&questions.some(ex=>(ex.subtema||'').trim().toLowerCase()===sub))
    return{dup:true,msg:`Subtema "${q.subtema}" já existe no banco`};
  if(pior.score>=DUP_LIMIAR)
    return{dup:true,msg:`${Math.round(pior.score*100)}% parecida com algo já ${pior.onde} — ${pior.ref}`};
  return{dup:false,msg:''};
}

// MODAL RESULTADO
function showResults(questoes,materia,banca){
  pendingGenerated=questoes.map(q=>({...q,materia,banca}));
  let nDup=0;
  document.getElementById('gen-q-list').innerHTML=pendingGenerated.map((q,i)=>{
    const d=checarDuplicata(q,pendingGenerated,i);
    if(d.dup)nDup++;
    const chk=d.dup?'':'checked';
    return `
    <div class="gen-q-item ${d.dup?'':'selected'}" id="gqi-${i}" style="${d.dup?'border-color:var(--yellow);opacity:.85':''}">
      <div class="gen-q-head">
        <input type="checkbox" class="gen-q-checkbox" ${chk} onchange="toggleQ(${i},this)" id="chk-${i}">
        <label for="chk-${i}" style="cursor:pointer"><span class="gen-q-num">QUESTÃO ${i+1}</span></label>
        <span class="tag tag-banca" style="margin-left:auto">${banca}</span>
        <span class="tag tag-materia">${materia}</span>
        ${q.subtema?`<span class="tag" style="background:var(--surface2);color:var(--ink2);border:1px solid var(--border2);font-size:9px">${q.subtema}</span>`:``}
      </div>
      ${d.dup?`<div style="background:var(--yellow-light);border-bottom:1px solid rgba(217,119,6,.3);padding:8px 16px;font-size:12px;color:var(--yellow-text)">⚠️ Possível repetição — ${d.msg}. Desmarcada por padrão.</div>`:''}
      <div class="gen-q-body">
        <div class="gen-q-text">${formatQuestionText(q.questao)}</div>
        <div class="gen-q-alts">${(q.alternativas||[]).map((alt,ai)=>`<div class="gen-alt ${ai===q.gabarito?'correta':''}">${ai===q.gabarito?'✓ ':''}${alt}</div>`).join('')}</div>
        ${q.comentario?`<div class="gen-q-comment"><strong style="color:var(--green)">✓ Por que está certa:</strong> ${q.comentario}</div>`:''}
      </div>
    </div>`;}).join('');
  if(nDup)notify(`⚠️ ${nDup} de ${pendingGenerated.length} parecem repetir conteúdo do banco — vieram desmarcadas`,'err');
  document.getElementById('result-modal').classList.add('open');
}

function toggleQ(i,cb){document.getElementById('gqi-'+i).classList.toggle('selected',cb.checked);}
function selectAll(){document.querySelectorAll('.gen-q-checkbox').forEach((c,i)=>{c.checked=true;document.getElementById('gqi-'+i).classList.add('selected');});}
function closeResultModal(){document.getElementById('result-modal').classList.remove('open');}
function saveSelected(){const sel=Array.from(document.querySelectorAll('.gen-q-checkbox')).map((c,i)=>c.checked?i:-1).filter(i=>i>=0);if(!sel.length){notify('Selecione ao menos uma','err');return;}sel.forEach(i=>questions.push(mkQ(pendingGenerated[i])));save();closeResultModal();updateSidebar();notify(`✓ ${sel.length} questões salvas!`,'ok');}

// BANCO
function renderBanco(){
  const srch=(document.getElementById('srch').value||'').toLowerCase();
  const fm=document.getElementById('f-materia').value,fb=document.getElementById('f-banca').value,fs=document.getElementById('f-status').value;
  const fsub=document.getElementById('f-subtema')?document.getElementById('f-subtema').value:'';
  let filtered=questions.filter(q=>{
    const qm=(q.materia||'').trim(),qb=(q.banca||'').trim(),qs=(q.subtema||'').trim();
    // A busca agora alcança o subtema também — antes olhava só enunciado e matéria.
    const ms=!srch||q.questao.toLowerCase().includes(srch)||qm.toLowerCase().includes(srch)||qs.toLowerCase().includes(srch);
    const st=!fs||(fs==='due'&&isDue(q))||(fs==='ok'&&!isDue(q)&&!q.suspensa)||(fs==='leech'&&isLeech(q))||(fs==='susp'&&q.suspensa)||(fs==='fav'&&!!q.favorita)||(fs==='conflito'&&!!q.conflito);
    return ms&&(!fm||qm===fm)&&(!fb||qb===fb)&&(!fsub||qs===fsub)&&st;
  });
  const el=document.getElementById('banco-list');
  if(!filtered.length){el.innerHTML=`<div class="empty-state"><div class="empty-icon">${questions.length===0?'✨':'🔍'}</div><div class="empty-title">${questions.length===0?'Banco vazio':'Sem resultados'}</div><div class="empty-sub">${questions.length===0?'Gere suas primeiras questões':'Tente outros filtros'}</div>${questions.length===0?'<button class="btn btn-accent" onclick="nav(\'gerar\')">✨ Gerar Questões</button>':''}</div>`;return;}
  el.innerHTML=filtered.map(q=>{const due=isDue(q),ease=Math.round((q.ef-1.3)/1.7*5),pips=Array.from({length:5},(_,i)=>`<div class="pip ${i<ease?'on':''}"></div>`).join(''),ri=questions.indexOf(q);
    const status=q.suspensa?'<span class="tag" style="background:var(--indigo-light);color:var(--indigo-text);border:1px solid var(--indigo-border)">⏸ Suspensa</span>'
      :due?'<span class="tag tag-due">🔴 Revisar</span>':'<span class="tag tag-ok">✓ Em dia</span>';
    const leech=isLeech(q)?`<span class="tag" style="background:var(--red-light);color:var(--red-text);border:1px solid var(--red-border)">🔥 Leech · ${q.erros} erros</span>`:'';
    const conf=q.conflito?`<span class="tag" style="background:var(--yellow-light);color:var(--yellow-text);border:1px solid var(--yellow-border)" title="O professor aponta outra alternativa. Use 🔍 Conferir gabaritos.">⚠️ Gabarito em conflito</span>`:'';
    const notaP=q.comentarioPessoal?`<span class="tag" style="background:var(--yellow-light);color:var(--yellow-text);border:1px solid var(--yellow-border)" title="${esc(q.comentarioPessoal.texto)}">🗒️ meu comentário</span>`:'';
    const fav=q.favorita?'<span class="tag" style="background:var(--yellow-light);color:var(--yellow-text);border:1px solid var(--yellow-border)" title="Leve preferência na fila — some sozinha conforme o domínio consolida">⭐ Favorita</span>':'';
    return `<div class="q-card" style="${q.suspensa?'opacity:.6':''}"><div class="q-card-head"><div class="q-meta">${q.materia?`<span class="tag tag-materia">${q.materia}</span>`:''}${q.banca?`<span class="tag tag-banca">${q.banca}</span>`:''}${q.subtema?`<span class="tag" style="background:var(--surface2);color:var(--ink2);border:1px solid var(--border2);cursor:pointer" title="${esc(q.origem||'')||'Filtrar por este subtema'}" onclick="filtrarPorSubtema('${esc(q.subtema).replace(/'/g,'&#39;')}')">${esc(q.subtema)}</span>`:''}${status}${leech}${fav}${conf}${notaP}</div><div style="display:flex;gap:6px"><button class="btn btn-outline btn-sm" title="${q.favorita?'Remover dos favoritos':'Favoritar — leve preferência na fila, sem furar o agendamento'}" onclick="toggleFavorita(${q.id})" style="${q.favorita?'color:var(--yellow-text)':''}">${q.favorita?'★':'☆'}</button><button class="btn btn-outline btn-sm" title="${q.suspensa?'Reativar':'Suspender — sai da fila, continua no banco'}" onclick="toggleSuspensa(${q.id})">${q.suspensa?'▶':'⏸'}</button><button class="btn btn-danger btn-sm" onclick="delQ(${ri})">🗑</button></div></div><div class="q-text">${formatQuestionText(q.questao)}</div><div class="q-footer"><div class="q-ease">Facilidade:<div class="ease-pips">${pips}</div></div><div class="q-score">✓${q.acertos} ✗${q.erros} · próx: ${q.suspensa?'suspensa':fmtNextDue(q.nextDue)}</div></div></div>`;
  }).join('');
  const mats=[...new Set(questions.map(q=>(q.materia||'').trim()).filter(Boolean))].sort(),bans=[...new Set(questions.map(q=>(q.banca||'').trim()).filter(Boolean))].sort();
  const ms=document.getElementById('f-materia'),bs=document.getElementById('f-banca'),cv=ms.value,cb=bs.value;
  ms.innerHTML='<option value="">Todas as matérias</option>'+mats.map(m=>`<option value="${esc(m)}">${esc(m)}</option>`).join('');
  bs.innerHTML='<option value="">Todas as bancas</option>'+bans.map(b=>`<option value="${esc(b)}">${esc(b)}</option>`).join('');
  ms.value=cv;bs.value=cb;
  popularSubtemas(true);
}
// Os subtemas do seletor acompanham a matéria escolhida — com 253 conceitos,
// uma lista única seria inutilizável.
function popularSubtemas(manter){
  const sel=document.getElementById('f-subtema');if(!sel)return;
  const fm=document.getElementById('f-materia').value,atual=sel.value;
  const subs=[...new Set(questions.filter(q=>!fm||(q.materia||'').trim()===fm)
    .map(q=>(q.subtema||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  sel.innerHTML='<option value="">Todos os subtemas</option>'+subs.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('');
  sel.value=(manter&&subs.includes(atual))?atual:'';
}
function filtrarPorSubtema(sub){
  nav('banco');
  document.getElementById('f-materia').value='';
  popularSubtemas();
  const sel=document.getElementById('f-subtema');
  sel.value=sub;
  if(sel.value!==sub){notify('Subtema não encontrado na lista','err');return;}
  renderBanco();
}
function delQ(idx){if(!confirm('Remover?'))return;questions.splice(idx,1);save();renderBanco();updateSidebar();notify('Removida','err');}

// ESTUDAR
function populateEstudarMaterias(){
  const sel=document.getElementById('f-estudar-materia');if(!sel)return;
  const cur=sel.value;
  const mats=[...new Set(questions.map(q=>(q.materia||'').trim()).filter(Boolean))].sort();
  sel.innerHTML='<option value="">Todas as matérias</option>'+mats.map(m=>`<option value="${esc(m)}">${esc(m)}</option>`).join('');
  if(mats.includes(cur))sel.value=cur;
}
// Lista vem do próprio histCache (matérias que já acumularam tempo em algum dia),
// não de `questions` — assim não aparece opção pra matéria que nunca foi cronometrada.
function populateHistTimeMaterias(){
  const sel=document.getElementById('hist-time-materia');if(!sel)return;
  const cur=sel.value;
  const set=new Set();
  Object.values(histCache).forEach(h=>{if(h&&h.mat)Object.keys(h.mat).forEach(m=>set.add(m));});
  const mats=[...set].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  sel.innerHTML='<option value="">Todas as matérias</option>'+mats.map(m=>`<option value="${esc(m)}">${esc(m)}</option>`).join('');
  sel.value=mats.includes(cur)?cur:'';
}
// Estudar um subtema isolado é o ponto do filtro: depois da estatística apontar
// onde você erra, você vem aqui e faz uma sessão só daquele conceito.
function populateEstudarSubtemas(){
  const sel=document.getElementById('f-estudar-subtema');if(!sel)return;
  const fm=estudarFiltroMateria(),cur=sel.value;
  const subs=[...new Set(questions.filter(q=>!fm||(q.materia||'').trim()===fm)
    .map(q=>(q.subtema||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  sel.innerHTML='<option value="">Todos os subtemas</option>'+subs.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');
  sel.value=subs.includes(cur)?cur:'';
}
function estudarFiltroSubtema(){
  const s=document.getElementById('f-estudar-subtema');return s?s.value:'';
}
// Um único predicado para "esta questão entra na sessão de hoje?", usado tanto pela
// montagem da fila quanto pelo contador ao vivo. Antes a regra estava duplicada nos
// dois lugares, e era só questão de tempo até divergirem.
function naSessao(q){
  const fm=estudarFiltroMateria(),fs=estudarFiltroSubtema();
  return isDue(q)&&!consolidadaAteProva(q)&&(!fm||(q.materia||'').trim()===fm)&&(!fs||(q.subtema||'').trim()===fs);
}
// Ordena a fila por SCORE de prioridade (atraso + importância + taxa de erro do
// assunto, os três em pé de igualdade) em vez de só atraso.
// Ainda evita repetir o mesmo assunto duas vezes seguidas — mas a diversificação é
// uma restrição "suave" (só proíbe repetir o grupo IMEDIATAMENTE anterior), não um
// rodízio cego: entre os grupos disponíveis, sempre entra o de maior score na frente.
// Isso resolve o problema de quantidade dominando a fila: um assunto com banco enorme
// só continua aparecendo mais se o score dele continuar mais alto, não porque sobrou
// mais item pra tirar dele.
// ===== QUALIDADE DA REVISÃO: QUESTÃO IRMÃ (26/09) =====
// Problema medido: a questão errada voltava no DIA SEGUINTE (lapso de 1 dia) —
// 95% dos reencontros com uma questão errada aconteciam em até 2 dias, com a
// resposta ainda fresca na memória. O acerto media lembrança, não domínio.
// E, com ~1.500 revisões vencidas disputando ~90 vagas, a fila não sabia se
// VOCÊ tinha errado aquela questão (o score olha o assunto, não a questão):
// 2 de cada 3 erros não voltavam antes da prova.
//
// Agora:
//  1. Errou → a questão espera QUAL_ERRO_ESPERA dias (ou o teto da reta final).
//  2. Nesse meio-tempo entra uma questão IRMÃ do mesmo assunto (de preferência
//     inédita; senão, uma que você não vê há QUAL_IRMA_RECENTE dias) — pratica o
//     conceito sem saber a resposta. No máximo 1 irmã por assunto por montagem,
//     até 20% do dia, revezando entre disciplinas para nenhuma ficar de fora.
//  3. Nas revisões, questão cuja ÚLTIMA resposta foi erro passa na frente.
//  4. Primeiro acerto de questão nunca errada → a entrada do SM-2 ganha
//     QUAL_ENTRADA_EXTRA dias (Difícil 6 · Bom 8 · Fácil 10 · Dominada = teto),
//     mantendo a diferença entre as notas e passando da janela em que a resposta
//     ainda está fresca. Sai da revisão até a prova quem nunca errou e tem dois
//     acertos separados por pelo menos QUAL_1ACERTO_ESPACO dias (data do 1º
//     acerto guardada em refAcerto; 4 dias por escolha do Anderson em 26/09). As consolidadas de antes de 26/09, sem essa
//     data, continuam valendo pela regra simples (2 acertos, 0 erro).
//  Questões com leechLimite erros ou mais ficam fora de 2 e 3 (falta teoria).
// Nada disso toca nas inéditas por déficit, no teto da fatia nem na reserva.
const QUAL_ERRO_ESPERA=5, QUAL_1ACERTO_ESPACO=4, QUAL_ENTRADA_EXTRA=4, QUAL_IRMA_VALIDADE=5, QUAL_IRMA_RECENTE=3;
const QUAL_IRMA_FRACAO=0.20, QUAL_IRMA_MAX=30;
let histResp=null;   // recarregado a cada montagem de fila a partir do registro de respostas
const chaveAssunto=q=>(q.materia||'—').trim()+'§'+(q.subtema||'—').trim();
function ehLeech(q){return (q.erros||0)>=(schedCfg().leechLimite||5);}
function consolidadaAteProva(q){
  const n=diasAteProva(); if(n===null||n<=0)return false;
  if(q.erros||0)return false;
  return (q.acertos||0)>=2;   // 2 acertos e nenhum erro: sai da fila até a prova (decisão do Anderson em 08/10; sem espaçamento mínimo)
}
// Chamado em rate() num ACERTO, antes de acertos/erros mudarem.
function registrarAcertoFirme(q){
  if(q.erros||0)return;
  const hoje=today();
  if(q.refAcerto){
    const dias=Math.round((new Date(hoje+'T12:00:00')-new Date(q.refAcerto+'T12:00:00'))/86400000);
    if(dias>=QUAL_1ACERTO_ESPACO)q.firmeOk=true;
  }else{ q.refAcerto=hoje; q.firmeOk=false; }
}
// A ÚLTIMA resposta foi erro? Campo gravado a cada resposta; para o que foi
// respondido antes dele existir, vem do registro de respostas; sem registro,
// aproximação: tem erro e está com intervalo curto (o SM-2 encurta após erro).
function ultimaFoiErro(q){
  if(q.ultimaErrada!==undefined)return !!q.ultimaErrada;
  if(histResp&&histResp.ultimaNota.has(q.id))return histResp.ultimaNota.get(q.id)===0;
  return (q.erros||0)>0&&(q.interval||0)<=3;
}
// Espera mínima que a nota impõe (usada no agendamento E no rótulo do botão)
function esperaMinimaQualidade(q,quality){
  const teto=schedCfg(q.fonte).tetoDias;
  if(quality===0)return Math.min(QUAL_ERRO_ESPERA,teto);
  if(!(q.erros||0)&&!(q.acertos||0)){
    const ent=(schedCfg(q.fonte).entrada||[null,2,4,6,21])[quality]||0;
    return Math.min(ent+QUAL_ENTRADA_EXTRA,teto);
  }
  return 0;
}
// Empurra só a DATA; o intervalo do SM-2 fica como calculado, para não inflar o
// crescimento dos próximos intervalos (a sua calibração de lapso continua valendo).
function aplicarEsperaQualidade(q,quality,r){
  const alvo=esperaMinimaQualidade(q,quality);
  if(!alvo)return r;
  const hoje=new Date(today()+'T12:00:00');
  const atual=Math.round((new Date(r.nextDue+'T12:00:00')-hoje)/86400000);
  if(atual>=alvo)return r;
  hoje.setDate(hoje.getDate()+alvo);
  return {...r,nextDue:ymd(hoje),espera:alvo};
}
async function carregarHistResp(){
  const L=idbOk?await lerLog():[];
  const porId=new Map(questions.map(q=>[q.id,q]));
  const ultimaNota=new Map(),ultimoTs=new Map(),recentesPorAssunto=new Map();
  const corte=Date.now()-(QUAL_IRMA_VALIDADE+1)*86400000;
  L.sort((a,b)=>a.ts-b.ts);
  for(const r of L){
    ultimaNota.set(r.qid,r.nota);ultimoTs.set(r.qid,r.ts);
    if(r.ts<corte)continue;
    const q=porId.get(r.qid);
    const k=q?chaveAssunto(q):((r.materia||'—')+'§'+(r.subtema||'—'));
    if(!recentesPorAssunto.has(k))recentesPorAssunto.set(k,[]);
    recentesPorAssunto.get(k).push(r);
  }
  // Dívida de irmã: erro dos últimos QUAL_IRMA_VALIDADE dias ainda sem nenhuma
  // resposta posterior a OUTRA questão do mesmo assunto. Deriva tudo do registro:
  // não precisa de estado extra, e vale entre sessões.
  const dividas=new Map(),janela=Date.now()-QUAL_IRMA_VALIDADE*86400000;
  recentesPorAssunto.forEach((lst,k)=>{
    const usados=new Set();
    for(const e of lst){
      if(e.nota!==0||e.ts<janela)continue;
      const q=porId.get(e.qid);if(!q||q.suspensa||materiaPausada(q)||ehLeech(q))continue;
      const pago=lst.findIndex((o,i)=>!usados.has(i)&&o.ts>e.ts&&o.qid!==e.qid);
      if(pago>=0){usados.add(pago);continue;}
      if(!dividas.has(k))dividas.set(k,{n:0,errados:new Set()});
      const d=dividas.get(k);d.n++;d.errados.add(e.qid);
    }
  });
  histResp={ultimaNota,ultimoTs,dividas};
  return histResp;
}
function filtroSessao(q){
  const fm=estudarFiltroMateria(),fs=estudarFiltroSubtema();
  return (!fm||(q.materia||'').trim()===fm)&&(!fs||(q.subtema||'').trim()===fs);
}
function escolherIrmas(limite,statsMap,excluir){
  if(!histResp||!limite||!histResp.dividas.size)return[];
  const ehNovaTec=q=>(q.fonte==='tec')&&!(q.acertos||0)&&!(q.erros||0)&&!(q.reps||0);
  const semResposta=q=>!(q.acertos||0)&&!(q.erros||0)&&!(q.reps||0);
  const recente=Date.now()-QUAL_IRMA_RECENTE*86400000;
  const porAssunto=new Map();
  questions.forEach(q=>{if(q.suspensa||materiaPausada(q)||!filtroSessao(q))return;const k=chaveAssunto(q);if(!porAssunto.has(k))porAssunto.set(k,[]);porAssunto.get(k).push(q);});
  // disciplinas com dívida; dentro de cada uma, os assuntos pelo score do assunto
  const scoreAssunto=k=>{const st=statsMap.get(k)||{taxaErro:0.5};return pesoDaMateria(k.split('§')[0])*(0.5+st.taxaErro);};
  const porDisc=new Map();
  histResp.dividas.forEach((v,k)=>{if(!porAssunto.has(k))return;const d=disciplinaDaMateria(k.split('§')[0]);if(!porDisc.has(d))porDisc.set(d,[]);porDisc.get(d).push(k);});
  porDisc.forEach(ks=>ks.sort((a,b)=>scoreAssunto(b)-scoreAssunto(a)));
  const discs=[...porDisc.keys()].sort((a,b)=>scoreAssunto(porDisc.get(b)[0])-scoreAssunto(porDisc.get(a)[0]));
  const out=[],usados=new Set(excluir||[]);
  // revezamento: uma volta por disciplina, um assunto por vez
  for(let volta=0;out.length<limite;volta++){
    let algum=false;
    for(const d of discs){
      const k=porDisc.get(d)[volta];if(!k)continue;algum=true;
      if(out.length>=limite)break;
      const err=histResp.dividas.get(k).errados;
      const cand=porAssunto.get(k).filter(q=>!usados.has(q.id)&&!err.has(q.id)&&!ultimaFoiErro(q)&&!ehLeech(q)&&!consolidadaAteProva(q)&&!((histResp.ultimoTs.get(q.id)||0)>recente));
      const pick=cand.find(ehNovaTec)||cand.find(semResposta)||cand.sort((a,b)=>(histResp.ultimoTs.get(a.id)||0)-(histResp.ultimoTs.get(b.id)||0))[0];
      if(pick){out.push(pick);usados.add(pick.id);}
    }
    if(!algum)break;
  }
  return out;
}
// Revisões: erros em aberto (menos leeches) na frente; a ordem dentro de cada
// bloco continua sendo a do seu score (ordenarFila).
function ordenarRevisoes(arr,statsMap){
  const abertos=arr.filter(q=>ultimaFoiErro(q)&&!ehLeech(q));
  const ids=new Set(abertos.map(q=>q.id));
  return [...ordenarFila(abertos,statsMap),...ordenarFila(arr.filter(q=>!ids.has(q.id)),statsMap)];
}

// ===== INÉDITAS POR DÉFICIT =====
// O rodízio do ordenarFila (MEM=6 por disciplina) escolhe QUAIS disciplinas entram
// pelo score, mas depois reveza entre elas por igual: com 7 no ciclo, cada uma leva
// ~1/7 das vagas qualquer que seja o peso. Medido em 25/09 (37 dias × 24 inéditas):
// Direito Tributário (20% da prova) com 148 e Português (3,3%) com 87; oito
// disciplinas da Prova I com ZERO; desvio de 62 p.p. do edital.
//
// Aqui cada disciplina tem uma META de participação = peso do edital × (0,5 + sua
// taxa de erro ajustada). A cada vaga entra a que está mais atrás da própria meta,
// contando o que já foi respondido de inéditas desde que isto entrou no ar (fica
// guardado no navegador). Mesma simulação: desvio 24 p.p., as 19 disciplinas no
// 1º ou 2º dia, Tributário 199, Português 31.
//
// DENTRO de cada disciplina a ordem continua sendo a do ordenarFila (score com
// fatia limitada). Revisões não passam por aqui.
const CHAVE_DEFICIT_NOVAS='questia_deficit_novas';
function lerServidasNovas(){
  try{
    const v=JSON.parse(localStorage.getItem(CHAVE_DEFICIT_NOVAS)||'null');
    if(v&&typeof v==='object'&&v.porDisc&&typeof v.porDisc==='object')return v;
  }catch(e){}
  return {desde:today(),porDisc:{}};
}
function registrarNovaServida(q){
  const s=lerServidasNovas(), d=disciplinaDaMateria(q.materia);
  s.porDisc[d]=(s.porDisc[d]||0)+1;
  try{localStorage.setItem(CHAVE_DEFICIT_NOVAS,JSON.stringify(s));}catch(e){}
}
function metaDaDisciplina(disc,ac,er){
  const ed=EDITAL.find(e=>e.n===disc);
  const peso=ed?ed.pts/PESO_MAX_EDITAL:0.4;   // fora do edital: mesmo peso do pesoDaMateria
  return peso*(0.5+taxaErroAjustada(ac||0,er||0));
}
function ordenarNovasPorDeficit(arr,statsMap,jaNaFila){
  if(!arr.length)return[];
  const ac={},er={};
  questions.forEach(q=>{
    if(q.suspensa)return;
    const d=disciplinaDaMateria(q.materia);
    ac[d]=(ac[d]||0)+(q.acertos||0); er[d]=(er[d]||0)+(q.erros||0);
  });
  const porDisc=new Map();
  arr.forEach(q=>{const d=disciplinaDaMateria(q.materia);if(!porDisc.has(d))porDisc.set(d,[]);porDisc.get(d).push(q);});
  const filas=new Map();porDisc.forEach((lista,d)=>filas.set(d,ordenarFila(lista,statsMap)));
  const meta={};filas.forEach((_,d)=>meta[d]=metaDaDisciplina(d,ac[d],er[d]));
  const serv={...lerServidasNovas().porDisc};
  // inéditas que já entraram na fila de hoje por outro caminho contam como servidas,
  // senão a reserva da Prova I escolheria de novo as mesmas disciplinas
  if(jaNaFila)Object.entries(jaNaFila).forEach(([d,n])=>serv[d]=(serv[d]||0)+n);
  let T=Object.values(serv).reduce((a,x)=>a+(+x||0),0);
  const out=[];let ultima=null;
  for(;;){
    const vivas=[...filas.keys()].filter(d=>filas.get(d).length);
    if(!vivas.length)break;
    const W=vivas.reduce((a,d)=>a+meta[d],0)||1;
    // não repete a mesma disciplina duas vezes seguidas enquanto houver outra
    const cand=vivas.length>1?vivas.filter(d=>d!==ultima):vivas;
    let melhor=cand[0],maior=-Infinity;
    cand.forEach(d=>{const def=(meta[d]/W)*(T+1)-(serv[d]||0);if(def>maior){maior=def;melhor=d;}});
    out.push(filas.get(melhor).shift());
    serv[melhor]=(serv[melhor]||0)+1;T++;ultima=melhor;
  }
  return out;
}

// ===== TETO DA FATIA (só para questões inéditas) =====
// fatiaMateria = (questões do subtema ÷ questões da matéria) × nº de subtemas.
// Sem limite ela ia de 0,77 a 10,8 — amplitude maior que a do próprio peso do
// edital (0,056 a 1,0), e as duas são MULTIPLICADAS. Resultado medido em 25/09:
//   · Prescrição e Decadência (fatia 8,0) levava as 34 vagas de Direito Civil
//     em 10 dias — 14% da fila para uma disciplina de 2,7% da prova;
//   · Inglês (5 pts, fatia 11,1) passava na frente da Zona Franca (30 pts, fatia 1,0);
//   · Zona Franca e Análise das DC's recebiam zero inéditas em 37 dias.
// A fatia estava medindo a granularidade da árvore do TEC (um subtema que cobre
// 23 artigos junta mais questão que um que cobre 9), não a ênfase da banca.
// Com teto 2 a fatia ainda desempata DENTRO da matéria, mas não passa mais por
// cima do edital. Vale SÓ para a fila de inéditas: a ordem das revisões foi
// calibrada contra os seus erros e continua recebendo o mapa original.
const TETO_FATIA_NOVAS=2;
function statsComTetoFatia(statsMap,teto){
  const out=new Map();
  statsMap.forEach((v,k)=>out.set(k,{...v,fatiaMateria:Math.min(v.fatiaMateria,teto)}));
  return out;
}
// Desempate "aleatório" estável dentro do mesmo dia: a ordem muda de um dia para o
// outro (o rodízio continua variando), mas recalcular a fila no mesmo dia dá a MESMA
// ordem — é o que permite exportar hoje o lote "Na prática" das questões que a tela
// de Estudar vai mesmo servir.
function embaralharDoDia(arr){
  const dia=today();
  const h=x=>{const t=dia+'|'+x;let v=0x811c9dc5;for(let i=0;i<t.length;i++){v^=t.charCodeAt(i);v=Math.imul(v,0x01000193)>>>0;}return v;};
  return arr.map(q=>({q,k:h(q.id)})).sort((a,b)=>a.k-b.k).map(o=>o.q);
}
function ordenarFila(arr,statsMap){
  statsMap=statsMap||estatisticasPorAssunto();
  const scored=embaralharDoDia(arr).map(q=>({q,s:calcScore(q,statsMap)}));
  const grupos=new Map();
  scored.forEach(item=>{
    const k=(item.q.materia||'—').trim()+'§'+(item.q.subtema||'—').trim();
    if(!grupos.has(k))grupos.set(k,[]);
    grupos.get(k).push(item);
  });
  grupos.forEach(g=>g.sort((a,b)=>b.s-a.s)); // maior score primeiro, dentro de cada grupo
  const out=[];
  // Rodízio com MEMÓRIA DE MATÉRIA, não de grupo.
  //
  // A regra antiga só evitava repetir o mesmo grupo (matéria§subtema) duas vezes
  // seguidas — e isso não segura nada, porque uma matéria com 12 subtemas tem 12
  // grupos e reveza entre eles mesma. Medido antes da correção, no perfil real:
  // média de 2 matérias distintas a cada 10 cartões, e uma sequência de 72 cartões
  // seguidos da mesma matéria. O dia virava blocos, não um caderno misto.
  //
  // Agora a memória guarda as últimas matérias usadas e prefere qualquer outra. Os
  // dois fallbacks existem para o fim da fila, quando sobram poucas matérias: aí a
  // restrição afrouxa sozinha em vez de travar.
  // O rodízio passou a ter memória de DISCIPLINA DO EDITAL, não de matéria.
  // Motivo: uma disciplina pode ser composta por várias matérias — "Direito
  // Tributário e Legislação Tributária Nacional" tem quatro (Direito Tributário,
  // Legislação Tributária Federal, Reforma Tributária, Leg. Trib. Estados/DF).
  // Elas se revezavam entre si e o rodízio nem percebia que era tudo a mesma
  // disciplina: medido, 24 das 60 questões do dia (40%) numa disciplina que vale
  // 20% da prova, enquanto 14 das 19 disciplinas ficavam com zero.
  // É o mesmo salto que a memória de matéria deu sobre a de grupo, um nível acima.
  //
  // MEM 6 em vez de 3: com 3, quatro disciplinas fecham o dia inteiro. Medido no
  // banco de 23/09 com os cadernos novos já dentro, num dia de 60 questões:
  //   MEM 3 por matéria    ->  5 disciplinas no dia, desvio de 95 p.p. do edital
  //   MEM 3 por disciplina ->  5 disciplinas, 85 p.p.
  //   MEM 6 por disciplina -> 10 disciplinas, 60 p.p.   <- escolhido
  //   MEM 9 por disciplina -> 13 disciplinas, 61 p.p. (já dilui demais a de 60 pts)
  const materiaDe=k=>disciplinaDaMateria(k.split('§')[0]);
  const MEM=6;
  let ultimoGrupo=null; const recentes=[];
  const MEM_GRUPOS=8, gruposRecentes=[];
  while([...grupos.values()].some(g=>g.length)){
    const vivos=[...grupos.entries()].filter(([k,g])=>g.length);
    let candidatos=vivos.filter(([k])=>!recentes.includes(materiaDe(k)));
    // Memória de ASSUNTO para quando a de disciplina não separa ninguém — é o caso
    // da fila de inéditas, que já chega aqui com uma disciplina só. Sem isto o
    // desempate "qualquer grupo menos o último" virava pingue-pongue entre os dois
    // assuntos de maior score: medido em 03/10, as 60 primeiras inéditas de
    // Contabilidade eram só Provisões e Instrumentos Financeiros, alternadas.
    if(!candidatos.length){
      const mem=Math.min(MEM_GRUPOS,vivos.length-1);
      const ult=mem>0?gruposRecentes.slice(-mem):[];
      candidatos=vivos.filter(([k])=>!ult.includes(k));
    }
    if(!candidatos.length)candidatos=vivos.filter(([k])=>k!==ultimoGrupo);
    if(!candidatos.length)candidatos=vivos;
    candidatos.sort((a,b)=>b[1][0].s-a[1][0].s); // entre os candidatos, o de maior score na frente vence
    const [k,g]=candidatos[0];
    out.push(g.shift().q);
    ultimoGrupo=k;
    gruposRecentes.push(k);if(gruposRecentes.length>MEM_GRUPOS)gruposRecentes.shift();
    recentes.push(materiaDe(k));
    if(recentes.length>MEM)recentes.shift();
  }
  return out;
}
// Distribui as novas ao longo da sessão em vez de empilhá-las no começo ou no fim.
// Bloco de 80 questões inéditas seguidas cansa e não é como a prova se apresenta;
// alternar mantém a sessão parecida com um caderno misto.
function intercalar(a,b){
  const out=[],tot=a.length+b.length;
  if(!tot)return out;
  let i=0,j=0;
  for(let k=0;k<tot;k++){
    // escolhe de qual lado tirar conforme o quanto cada fila já andou, proporcionalmente
    const pa=a.length?i/a.length:2, pb=b.length?j/b.length:2;
    if(pa<=pb&&i<a.length)out.push(a[i++]);
    else if(j<b.length)out.push(b[j++]);
    else if(i<a.length)out.push(a[i++]);
  }
  return out;
}
// Projeção de acerto de uma prova, com a MESMA conta da aba Meta (média dos pontos
// já medidos). Devolve null quando não há medição — sem dado não há o que proteger.
function projecaoProva(P){
  try{
    const {linhas}=dadosMeta();
    const cd=linhas.filter(d=>d.p===P&&d.taxa!==null);
    const ptsC=cd.reduce((a,d)=>a+d.pts,0);
    if(!ptsC)return null;
    return cd.reduce((a,d)=>a+d.pts*d.taxa,0)/ptsC;
  }catch(e){return null;}
}
// A Meta é painel de visualização e NÃO prioriza a fila — isso continua valendo, e é
// decisão sua: esforço marginal não é constante, então ponto de edital não manda no
// que estudar. O que entra aqui é diferente: um freio binário. Enquanto a Prova I
// estiver acima do piso eliminatório, nada muda. Abaixo do piso, ela deixa de poder
// ser espremida pela Prova II, que vale 210 dos 300 pontos e por isso domina o score.
// Medido antes da trava: 20% do dia para a Prova I quando 30% das vencidas eram dela.
function reservaProvaI(elegiveis){
  const cfg=metaCfg();
  const proj=projecaoProva('I');
  if(proj===null||proj>=cfg.pisoProva)return 0;      // acima do piso: sem reserva
  const daProva={};EDITAL.forEach(d=>d.m.forEach(m=>daProva[m]=d.p));
  // O tamanho da reserva é a fatia da Prova I entre as REVISÕES vencidas — o que você
  // já estudou e está voltando. Antes contava também as inéditas, e aí quem decidia
  // era o volume importado: com milhares de inéditas de Constitucional, Civil,
  // Administrativo e Português no banco, a reserva dava 77% do dia a uma prova que
  // vale 30% dos pontos (medido em 25/09). Contando só revisões dá ~45%: reflete
  // onde você erra (questão errada volta mais cedo), não quanto você importou.
  // A cobertura das disciplinas pouco tocadas continua garantida pela fila de
  // inéditas por déficit (peso × erro), que não depende deste número.
  const ehNovaR=q=>(q.fonte==='tec')&&!(q.acertos||0)&&!(q.erros||0)&&!(q.reps||0);
  const revisoes=elegiveis.filter(q=>!ehNovaR(q));
  if(!revisoes.length)return 0;
  const nI=revisoes.filter(q=>daProva[(q.materia||'').trim()]==='I').length;
  if(!nI)return 0;
  return nI/revisoes.length;
}
// Garante à Prova I a fatia que ela já tem entre as questões vencidas, trocando as
// últimas colocadas da Prova II pelas melhores da Prova I que ficaram de fora. Não
// aumenta o dia nem mexe no agendamento de nada: é a mesma quantidade de questões,
// com a composição corrigida.
function aplicarReservaProvaI(fila,elegiveis,teto){
  const fatia=reservaProvaI(elegiveis);
  if(!fatia)return fila;
  const daProva={};EDITAL.forEach(d=>d.m.forEach(m=>daProva[m]=d.p));
  const ehI=q=>daProva[(q.materia||'').trim()]==='I';
  const alvo=Math.round(fila.length*fatia);
  const temI=fila.filter(ehI).length;
  if(temI>=alvo)return fila;
  const naFila=new Set(fila.map(q=>q.id));
  // candidatas: questões da Prova I elegíveis que não entraram, na ordem do score
  const candI=elegiveis.filter(q=>ehI(q)&&!naFila.has(q.id));
  const foraI=ordenarRevisoes(candI,estatisticasPorAssunto());
  if(!foraI.length)return fila;
  const precisa=Math.min(alvo-temI,foraI.length);
  // remove do fim as piores da Prova II (o fim da fila é a cauda de menor score)
  const saida=[];let removidas=0;
  for(let i=fila.length-1;i>=0&&removidas<precisa;i--){
    if(!ehI(fila[i])){saida.push(i);removidas++;}
  }
  const set=new Set(saida);
  const mantidas=fila.filter((_,i)=>!set.has(i));
  // A reserva escolhia as inéditas da Prova I pelo ordenarFila puro (fatia sem teto,
  // rodízio igual) — era por aqui que Prescrição e Decadência continuava chegando
  // mesmo com a fila principal corrigida. Agora: o tamanho da reserva, as revisões
  // escolhidas e a posição de cada uma ficam IGUAIS; só as inéditas do bloco são
  // trocadas pelas que a fila por déficit escolheria.
  const bloco=foraI.slice(0,removidas);
  const ehNovaR=q=>(q.fonte==='tec')&&!(q.acertos||0)&&!(q.erros||0)&&!(q.reps||0);
  const nN=bloco.filter(ehNovaR).length;
  if(nN){
    const jaNaFila={};
    mantidas.forEach(q=>{if(ehNovaR(q)){const d=disciplinaDaMateria(q.materia);jaNaFila[d]=(jaNaFila[d]||0)+1;}});
    const porDef=ordenarNovasPorDeficit(candI.filter(ehNovaR),
      statsComTetoFatia(estatisticasPorAssunto(),TETO_FATIA_NOVAS),jaNaFila).slice(0,nN);
    let j=0;
    for(let i=0;i<bloco.length&&j<porDef.length;i++)if(ehNovaR(bloco[i]))bloco[i]=porDef[j++];
  }
  const nova=intercalar(bloco,mantidas);
  return nova.slice(0,teto||nova.length);
}
async function initStudy(){
  renderAvisoReta();renderMateriasPausadas();
  populateEstudarMaterias();
  populateEstudarSubtemas();
  sessOk=0;sessErr=0;ratingLock=false;
  const cfg=schedCfg();
  const elegiveis=questions.filter(naSessao);
  // O rodízio de ordenarFila reparte o dia entre GRUPOS (matéria§subtema), não entre
  // questões. Um banco antigo espalhado por 30 matérias ocupa dezenas de grupos; um
  // caderno recém-importado ocupa dois ou três. Resultado medido em simulação: das 60
  // primeiras questões do dia, ZERO eram do caderno novo — a primeira só aparecia na
  // posição 60. Por isso as novas de banca ganham uma cota própria do dia, disputada
  // à parte, em vez de competirem no mesmo rodízio.
  const ehNova=q=>(q.fonte==='tec')&&!(q.acertos||0)&&!(q.erros||0)&&!(q.reps||0);
  const statsMap=estatisticasPorAssunto(); // uma vez só por sessão, reaproveitado nas duas listas abaixo
  // Inéditas usam a fatia COM TETO; revisões seguem com o mapa original, intocado.
  await carregarHistResp();
  const restaDia=(cfg.limiteDiario>0&&!ignorarLimite)?Math.max(0,cfg.limiteDiario-respondidasHoje()):null;
  const limIrmas=restaDia===null?QUAL_IRMA_MAX:Math.min(QUAL_IRMA_MAX,Math.round(restaDia*QUAL_IRMA_FRACAO));
  const irmas=escolherIrmas(limIrmas,statsMap);
  const idsIrma=new Set(irmas.map(q=>q.id));
  const eleg=elegiveis.filter(q=>!idsIrma.has(q.id));
  let novas=ordenarNovasPorDeficit(eleg.filter(ehNova),statsComTetoFatia(statsMap,TETO_FATIA_NOVAS));
  let velhas=ordenarRevisoes(eleg.filter(q=>!ehNova(q)),statsMap);
  metaEstourada=false;
  let fila;
  if(restaDia!==null){
    const resta=restaDia, nI=irmas.length;
    const cota=Math.round(resta*(cfg.cotaNovas??0.40));
    // Cada lado cede o que não usar: sem caderno novo, o dia inteiro vai para revisão;
    // sem atrasado, o dia inteiro vai para o caderno novo. A cota nunca ociosa slots.
    // As irmãs saem da parte de REVISÃO do dia — a cota de inéditas não muda.
    let qN=Math.min(novas.length,cota);
    let qV=Math.min(velhas.length,Math.max(0,resta-qN-nI));
    qN=Math.min(novas.length,Math.max(0,resta-nI-qV));
    if(elegiveis.length>resta)metaEstourada=true;
    fila=intercalar(novas.slice(0,qN),velhas.slice(0,qV));
    fila=aplicarReservaProvaI(fila,eleg,Math.max(0,resta-nI));
    fila=intercalar(irmas,fila);
  }else{
    fila=intercalar(irmas,intercalar(novas,velhas));
  }
  const forcadas=await questoesForcadasPorCobertura();
  const idsJaNaFila=new Set(fila.map(q=>q.id));
  const novasForcadas=forcadas.filter(q=>!idsJaNaFila.has(q.id));
  if(novasForcadas.length){
    fila=[...novasForcadas,...fila]; // entram no topo — cobertura tem prioridade sobre o rodízio normal
    notify(`📌 ${novasForcadas.length} questão(ões) trazida(s) pro topo por peso de edital sem aparecer há ${DIAS_SEM_APARECER}+ dias`,'ok');
  }
  dueQueue=fila;
  dueIdx=0;updateSessBar();showCard();
}
function continuarAlemDaMeta(){ignorarLimite=true;initStudy();notify('Seguindo além da meta do dia','ok');}
function shuffle(arr){const a=[...arr];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function estudarFiltroMateria(){
  return document.getElementById('f-estudar-materia')?document.getElementById('f-estudar-materia').value:'';
}
function liveDueCount(){return questions.filter(naSessao).length;}
function showCard(){
  // Sempre recalculado a partir de `questions` (não da fila congelada no início da sessão),
  // para não ficar dessincronizado do total real caso novas questões vençam, sejam
  // geradas/importadas, ou o dia vire durante a sessão.
  // liveDueCount() já recalcula a partir de `questions`: uma questão respondida deixa
  // de estar vencida sozinha. Subtrair (sessOk+sessErr) descontava a mesma questão
  // duas vezes — o contador caía de 2 em 2.
  document.getElementById('ss-due').textContent=liveDueCount();
  updateSidebar();
  updateSessProgress();
  if(dueIdx>=dueQueue.length){
    document.getElementById('fc-area').style.display='none';
    const nd=document.getElementById('no-due');nd.style.display='block';
    const sobram=liveDueCount();
    nd.innerHTML=metaEstourada
      ? `<div class="empty-icon">✅</div><div class="empty-title">Meta do dia concluída</div>
         <div class="empty-sub">Ainda há <strong>${sobram}</strong> questões vencidas, mas o limite diário existe para você não responder no automático só para zerar a fila.<br>Elas continuam ali amanhã — nada se perde.</div>
         <button class="btn btn-outline" onclick="continuarAlemDaMeta()">Continuar mesmo assim</button>`
      : `<div class="empty-icon">🎉</div><div class="empty-title">Revisões em dia!</div>
         <div class="empty-sub">Nenhuma questão pendente${estudarFiltroMateria()?' nesta matéria':''}. Gere mais ou volte amanhã.</div>`;
    return;
  }
  document.getElementById('fc-area').style.display='block';document.getElementById('no-due').style.display='none';
  const q=dueQueue[dueIdx];
  // Pula questões com dados corrompidos/incompletos
  if(!q||!q.questao||!q.alternativas||q.alternativas.length<2){dueIdx++;showCard();return;}
  // Embaralha alternativas mantendo rastreio da correta — exceto em questões Certo/Errado,
  // onde embaralhar não reduz decoreba de posição (só existem 2 opções, sempre 50/50) e só
  // confunde a leitura, já que o rótulo (A/B) deixa de corresponder à ordem Certo→Errado do dado original.
  // A alternativa correta é achada pelo TEXTO guardado na questão, não pela posição:
  // assim a "dança das cadeiras" do embaralhamento nunca desencontra o gabarito, e um
  // índice que tenha entrado torto na importação não consegue marcar a errada de verde.
  const gi=indiceGabarito(q);
  // `orig` preserva a posição no dado da banca. O cartão embaralha, mas o
  // comentário do professor fala das letras ORIGINAIS — sem isto, clicar na
  // alternativa C do cartão saltaria para a letra errada do comentário.
  const alts=(q.alternativas||[]).map((txt,i)=>({txt:txt.replace(/^[A-E]\)\s*/,''),isCorrect:i===gi,orig:i}));
  const isCertoErrado=alts.length===2&&alts.every(a=>/^(certo|errado)$/i.test(a.txt.trim()));
  const shuffled=isCertoErrado?alts:shuffle(alts);
  // Guardado fora do objeto: gravar isso na questão sujava o localStorage e o backup .json
  currentCorrect=shuffled.findIndex(a=>a.isCorrect);
  if(currentCorrect<0)currentCorrect=0;   // nunca deixar o cartão sem alternativa correta
  const meta=[q.materia,q.banca].filter(Boolean).join(' · ')||'Questão';
  const subtemaStr=q.subtema?` · ${q.subtema}`:'';
  document.getElementById('fc-meta').textContent=meta+subtemaStr;
  renderNotaQuestao(q,false);
  const favBtn=document.getElementById('fc-fav-btn');
  if(favBtn){favBtn.textContent=q.favorita?'★':'☆';favBtn.style.color=q.favorita?'var(--yellow-text)':'var(--muted)';favBtn.title=q.favorita?'Remover dos favoritos':'Favoritar — leve preferência na fila, sem furar o agendamento do SM-2';}
  document.getElementById('fc-q').innerHTML=formatQuestionText(q.questao);
  document.getElementById('fc-alts').innerHTML=shuffled.map((alt,i)=>`<button class="alt-btn" onclick="marcarAlternativa(${i})" ondblclick="descartarAlternativa(${i})" id="alt-${i}" data-orig="${String.fromCharCode(65+(alt.orig||0))}"><div class="alt-letter">${String.fromCharCode(65+i)}</div><div>${formatQuestionText(alt.txt)}</div></button>`).join('');
  altSelecionada=null;
  const confirmWrap=document.getElementById('alt-confirm-wrap');
  if(confirmWrap)confirmWrap.style.display='block';
  atualizarBotaoConfirmar();
  // Aviso no próprio cartão quando o professor contraria o gabarito do arquivo.
  // Deixar isso só num aviso que some em 4 segundos era passivo demais: a questão
  // continuava sendo cobrada com a resposta errada até você lembrar de abrir o
  // auditor. O lugar de avisar é aqui, no instante em que a questão é estudada.
  const cx=document.getElementById('fc-conflito');
  if(q.conflito&&q.conflito.tipo==='professor'&&q.alternativas[q.conflito.para]!=null){
    cx.style.display='block';
    cx.innerHTML=`<div style="padding:11px 13px;border-radius:10px;background:var(--yellow-light);border:1px solid var(--yellow-border);margin-bottom:12px">
      <div style="font-size:12px;font-weight:700;color:var(--yellow-text)">⚠️ Gabarito em conflito — não responda no automático</div>
      <div style="font-size:12px;color:var(--yellow-text);line-height:1.6;margin-top:6px">O arquivo importado marca uma alternativa, mas o comentário do professor (letra ${esc(q.conflito.letraProf||'?')}, confiança ${esc(q.conflito.conf||'?')}) aponta esta:</div>
      <div style="font-size:12px;color:var(--yellow-text);line-height:1.6;margin-top:6px;padding:7px 9px;background:rgba(180,83,9,.08);border-radius:7px">${esc(String(q.alternativas[q.conflito.para]).slice(0,300))}</div>
      <div style="display:flex;gap:8px;margin-top:9px;flex-wrap:wrap">
        <button class="btn btn-outline btn-sm" onclick="corrigirConflitoAtual(true)">Usar a do professor</button>
        <button class="btn btn-ghost btn-sm" onclick="corrigirConflitoAtual(false)">Manter a do arquivo</button>
      </div>
    </div>`;
  } else { cx.style.display='none'; cx.innerHTML=''; }
  document.getElementById('fc-ans').classList.remove('show');
  {const bp=document.getElementById('fc-pratica');if(bp){bp.style.display='none';bp.innerHTML='';}}
  document.querySelector('.fc-wrap').classList.remove('expanded');
  document.getElementById('fc-rate').classList.remove('show');
  document.getElementById('fc-delete-wrap').style.display='none';
  cardMostradoEm=Date.now(); cliqueCorreto=null;
  pincelZerar(); fecharCalculadora(); cardTempoDescontado=0; ocultoDesde=null;
  atualizarBadgeLoteClaude();
}
// Resolve o conflito da questão que está na tela, sem sair do estudo.
// "Manter a do arquivo" não é ignorar: marca a questão como já decidida, para o
// aviso não voltar a cada revisão — a decisão fica registrada, não esquecida.
function corrigirConflitoAtual(aceitarProfessor){
  const q=dueQueue[dueIdx];if(!q||!q.conflito)return;
  const i=questions.findIndex(x=>x.id===q.id);if(i===-1)return;
  if(aceitarProfessor){
    const alvo=q.conflito.para;
    questions[i].gabarito=alvo;
    questions[i].gabTexto=questions[i].alternativas[alvo];
  }
  questions[i].conflito=null;
  questions[i].conflitoDecidido=aceitarProfessor?'professor':'arquivo';
  Object.assign(q,{gabarito:questions[i].gabarito,gabTexto:questions[i].gabTexto,conflito:null,conflitoDecidido:questions[i].conflitoDecidido});
  save();
  notify(aceitarProfessor?'✓ Gabarito corrigido para a alternativa do professor':'Mantido o gabarito do arquivo','ok');
  showCard();
}
// ===== CORRIGIR GABARITO MANUALMENTE =====
// Existe pra quando NENHUM dos sinais automáticos (linha "Gabarito:" do arquivo,
// texto batendo com a alternativa, veredito do comentário do professor) acerta —
// aí sobra só a pessoa que está estudando decidir. Uma vez corrigido aqui, fica
// gravado em gabarito/gabTexto exatamente como uma importação faria, então tudo
// que já lê esses dois campos (SM-2, "conferir gabaritos", export) respeita a
// correção sem precisar saber que ela foi manual.
function abrirCorrigirGabarito(){
  const q=dueQueue[dueIdx];
  if(!q||!q.alternativas||!q.alternativas.length)return;
  const meta=[q.materia,q.banca].filter(Boolean).join(' · ')||'Questão';
  document.getElementById('gabmod-meta').textContent=meta;
  const atual=indiceGabarito(q);
  document.getElementById('gabmod-lista').innerHTML=q.alternativas.map((txt,i)=>{
    const letra=String.fromCharCode(65+i);
    const marcada=i===atual;
    const corpo=esc(String(txt).replace(/^[A-E]\)\s*/,''));
    return`<button class="btn ${marcada?'btn-primary':'btn-outline'}" style="text-align:left;justify-content:flex-start;white-space:normal;line-height:1.5;padding:10px 14px" onclick="salvarCorrecaoGabarito(${i})"><strong style="margin-right:8px">${letra}${marcada?' ✓ (gabarito atual)':''}</strong>${corpo}</button>`;
  }).join('');
  document.getElementById('gabarito-modal').classList.add('open');
}
function fecharCorrigirGabarito(){
  document.getElementById('gabarito-modal').classList.remove('open');
}
function salvarCorrecaoGabarito(i){
  const q=dueQueue[dueIdx];if(!q)return;
  const ri=questions.findIndex(x=>x.id===q.id);if(ri===-1)return;
  questions[ri].gabarito=i;
  questions[ri].gabTexto=questions[ri].alternativas[i];
  // Uma correção manual é uma decisão definitiva: some com o aviso de conflito
  // (senão voltaria a acender a cada revisão) e marca a origem, só pra registro.
  questions[ri].conflito=null;
  questions[ri].conflitoDecidido='manual';
  Object.assign(q,{gabarito:questions[ri].gabarito,gabTexto:questions[ri].gabTexto,conflito:null,conflitoDecidido:'manual'});
  save();
  fecharCorrigirGabarito();
  notify('✓ Gabarito corrigido para a alternativa '+String.fromCharCode(65+i),'ok');
  showCard();
}
// ===== MEU COMENTÁRIO DA QUESTÃO =====
// Nota pessoal presa à questão (q.comentarioPessoal), que reaparece sempre que ela
// voltar na fila. Antes de responder fica recolhida, para não entregar a resposta;
// depois de responder abre sozinha.
function renderNotaQuestao(q,aberto){
  const box=document.getElementById('fc-nota-pessoal'),btn=document.getElementById('fc-nota-btn');
  const n=q&&q.comentarioPessoal&&q.comentarioPessoal.texto;
  if(btn){btn.style.color=n?'var(--accent2)':'var(--muted)';btn.title=n?'Ver/editar meu comentário sobre esta questão':'Meu comentário sobre esta questão — fica guardado nela e aparece sempre que ela voltar';}
  if(!box)return;
  if(!n){box.style.display='none';box.innerHTML='';return;}
  const quando=q.comentarioPessoal.em?new Date(q.comentarioPessoal.em).toLocaleDateString('pt-BR'):'';
  box.style.display='block';
  box.innerHTML=`<details class="pratica-box" style="border-left-color:var(--yellow)"${aberto?' open':''}><summary style="color:var(--yellow-text)">🗒️ Meu comentário <small>${quando?'escrito em '+quando:''} · clique para ${aberto?'recolher':'abrir'}</small></summary>`
    +`<div style="white-space:pre-wrap;margin-top:8px">${esc(n)}</div>`
    +`<div style="margin-top:8px;text-align:right"><button class="note-btn" onclick="abrirNotaQuestao()">✏️ Editar</button></div></details>`;
}
function abrirNotaQuestao(){
  const q=dueQueue[dueIdx];if(!q){notify('Nenhuma questão ativa','err');return;}
  const real=questions.find(x=>x.id===q.id)||q;
  document.getElementById('notaq-meta').textContent=[real.materia,real.subtema].filter(Boolean).join(' · ');
  document.getElementById('notaq-txt').value=(real.comentarioPessoal&&real.comentarioPessoal.texto)||'';
  document.getElementById('notaq-apagar').style.visibility=real.comentarioPessoal?'visible':'hidden';
  document.getElementById('notaq-modal').classList.add('open');
  setTimeout(()=>document.getElementById('notaq-txt').focus(),60);
}
function fecharNotaQuestao(){document.getElementById('notaq-modal').classList.remove('open');}
function gravarNotaQuestao(texto){
  const q=dueQueue[dueIdx];if(!q)return;
  const real=questions.find(x=>x.id===q.id);if(!real)return;
  if(texto)real.comentarioPessoal={texto,em:new Date().toISOString()};else delete real.comentarioPessoal;
  if(q!==real){if(texto)q.comentarioPessoal=real.comentarioPessoal;else delete q.comentarioPessoal;}
  save();fecharNotaQuestao();
  renderNotaQuestao(real,document.getElementById('fc-ans').classList.contains('show'));
}
function salvarNotaQuestao(){
  const t=document.getElementById('notaq-txt').value.trim();
  if(!t){notify('Escreva algo — ou use Apagar','err');return;}
  gravarNotaQuestao(t);notify('🗒️ Comentário guardado nesta questão','ok');
}
function apagarNotaQuestao(){
  if(!confirm('Apagar o seu comentário desta questão?'))return;
  gravarNotaQuestao('');notify('Comentário apagado','ok');
}

// ===== MARCAR / DESCARTAR ALTERNATIVAS (antes de confirmar) =====
// Fluxo de duas etapas para simular como se resolve questão no papel: 1 clique
// marca a alternativa que você está considerando (sem revelar nada ainda);
// 2 cliques (duplo clique) risca/descarta uma alternativa que você já eliminou.
// Só quando clica em "Confirmar resposta" é que a questão é de fato respondida
// (dispara selectAlt, que revela certo/errado e o comentário).
let altSelecionada=null;
function respostaJaConfirmada(){
  const btns=document.querySelectorAll('#fc-alts .alt-btn');
  return btns.length>0&&(btns[0].classList.contains('respondida')||btns[0].disabled);
}
function marcarAlternativa(i){
  // Depois de confirmada, a alternativa deixa de ser botão de escolha e vira
  // atalho: leva direto ao ponto do comentário em que o professor trata dela.
  if(respostaJaConfirmada()){irParaComentario(i);return;}
  const btns=document.querySelectorAll('#fc-alts .alt-btn');
  btns.forEach((b,idx)=>{
    if(idx===i){b.classList.remove('descartada');b.classList.add('marcada');}
    else b.classList.remove('marcada');
  });
  altSelecionada=i;
  atualizarBotaoConfirmar();
}
function descartarAlternativa(i){
  if(respostaJaConfirmada())return;
  const b=document.getElementById('alt-'+i);
  if(!b)return;
  const vaiDescartar=!b.classList.contains('descartada');
  b.classList.toggle('descartada');
  if(vaiDescartar){
    // alternativa recém-descartada não pode continuar marcada como resposta
    b.classList.remove('marcada');
    if(altSelecionada===i)altSelecionada=null;
  }
  atualizarBotaoConfirmar();
}
function atualizarBotaoConfirmar(){
  const btn=document.getElementById('alt-confirm-btn');
  if(!btn)return;
  btn.disabled=altSelecionada==null;
  btn.textContent=altSelecionada==null?'Selecione uma alternativa':`✓ Confirmar alternativa ${String.fromCharCode(65+altSelecionada)}`;
}
function confirmarResposta(){
  if(altSelecionada==null)return;
  selectAlt(altSelecionada);
}
function selectAlt(chosen){
  const q=dueQueue[dueIdx];
  const correct=(currentCorrect>=0&&currentCorrect!=null)?currentCorrect:indiceGabarito(q);
  cliqueCorreto=(chosen===correct);   // o dado honesto de acerto, guardado para o log
  const confirmWrap=document.getElementById('alt-confirm-wrap');
  if(confirmWrap)confirmWrap.style.display='none';
  // Antes marcava b.disabled=true. Botão desabilitado não dispara clique, e a
  // alternativa respondida precisa continuar clicável para levar ao comentário.
  // A trava de "não pode mais escolher" passou para a classe .respondida.
  document.querySelectorAll('.alt-btn').forEach((b,i)=>{b.classList.remove('marcada','descartada');b.classList.add('respondida');b.title='Clique para ir ao trecho do comentário que trata desta alternativa';if(i===correct)b.classList.add('correct');else if(i===chosen&&chosen!==correct)b.classList.add('wrong');else b.classList.add('dimmed');});
  const gabEl=document.getElementById('fc-ans-gabarito');
  if(q.comentario){
    // Comentário de professor chega com markdown e passa de 10 mil caracteres.
    // textContent mostrava os asteriscos crus e estourava a caixa.
    // Antes tinha max-height+scroll interno aqui — obrigava a rolar com o mouse
    // dentro de uma caixinha, diferente do TEC, onde o comentário só cresce com
    // a página. Tirado: agora o scroll é o da página mesmo, como no original.
    gabEl.style.maxHeight='';gabEl.style.overflowY='';
    gabEl.innerHTML=formatarComentarioProfessor(q.comentario,String.fromCharCode(65+correct));
    renderPratica(questions.find(x=>x.id===q.id)||q,false);
    // Comentário de professor costuma ser longo — numa tela ultrawide, a caixa de
    // 700px sobra vazio dos dois lados. Só alarga quando a explicação realmente
    // aparece; a pergunta e as alternativas continuam estreitas, que é onde a
    // leitura curta se beneficia de coluna mais estreita.
    document.querySelector('.fc-wrap').classList.add('expanded');
    document.getElementById('fc-ans').classList.add('show');
    renderNotaQuestao(questions.find(x=>x.id===q.id)||q,true);
  }
  updateRatingLabels(q);
  document.getElementById('fc-rate').classList.add('show');
  document.getElementById('fc-delete-wrap').style.display='block';
}
// Mostra em cada botão o intervalo REAL que aquela nota vai gerar para esta questão,
// em vez de rótulos genéricos ("Resetar", "+1 dia") que não batiam com o cálculo.
function updateRatingLabels(q){
  const ateProva=diasAteProva();
  for(let quality=0;quality<5;quality++){
    const el=document.getElementById('rsub-'+quality);if(!el)continue;
    const d=Math.max(sm2(quality,q.reps??0,q.ef??2.5,q.interval??0,true,q.fonte).intervalBase,esperaMinimaQualidade(q,quality));
    const txt=d===1?'amanhã':d<30?d+' dias':d<365?Math.round(d/30)+' meses':'1 ano';
    // Aviso de consequência invisível: um intervalo que cai DEPOIS da prova significa
    // que aquela questão não volta mais antes dela. O rótulo dizia só "1 ano", e
    // "1 ano" não deixa óbvio que a prova é daqui a 44 dias. Vale para qualquer nota —
    // o Fácil já fazia isso muito antes da nota Dominada existir.
    const passaDaProva = ateProva!==null && ateProva>0 && d>ateProva;
    el.textContent = passaDaProva ? txt+' · depois da prova' : txt;
    el.classList.toggle('pos-prova',passaDaProva);
  }
}
function deleteCurrent(){
  if(!confirm('Excluir esta questão do banco?\nEla será removida permanentemente.')) return;
  const q=dueQueue[dueIdx];
  const ri=questions.findIndex(x=>x.id===q.id);
  if(ri!==-1){ questions.splice(ri,1); save(); }
  // Remove da fila atual também
  dueQueue.splice(dueIdx,1);
  updateSidebar();
  notify('Questão excluída do banco','err');
  // Não incrementa dueIdx pois removemos o elemento atual
  updateSessBar();
  showCard();
}

function rate(quality){
  // Trava contra duplo clique / tecla repetida: sem ela, dois cliques rápidos
  // aplicavam o SM-2 duas vezes na mesma questão.
  if(ratingLock)return;
  const q=dueQueue[dueIdx];if(!q)return;
  const ri=questions.findIndex(x=>x.id===q.id);
  if(ri===-1){dueIdx++;showCard();return;}
  ratingLock=true;
  const eraNova=(questions[ri].fonte==='tec')&&!(questions[ri].acertos||0)&&!(questions[ri].erros||0)&&!(questions[ri].reps||0);
  // espera mínima de qualidade calculada ANTES de acertos/erros mudarem
  const r=aplicarEsperaQualidade(questions[ri],quality,sm2(quality,questions[ri].reps,questions[ri].ef,questions[ri].interval,false,questions[ri].fonte));
  Object.assign(questions[ri],{reps:r.reps,ef:r.ef,interval:r.interval,nextDue:r.nextDue});
  if(quality>0)registrarAcertoFirme(questions[ri]);
  if(quality===0){questions[ri].erros++;sessErr++;}else{questions[ri].acertos++;sessOk++;}
  questions[ri].ultimaErrada=(quality===0);
  if(eraNova)registrarNovaServida(questions[ri]);   // alimenta a fila de inéditas por déficit
  // Mostrar feedback de intervalo usando o intervalo real calculado pelo SM-2
  const dias=r.espera||r.interval;
  const intervalMsg=dias<=0?'hoje':dias===1?'amanhã':`em ${dias} dia${dias>1?'s':''}`;
  const labels=['✗ Errei','↩ Difícil','✓ Bom','⚡ Fácil','🎓 Dominada'];
  notify(`${labels[quality]} — próxima revisão ${intervalMsg}`,'interval');
  // Tempo gasto nesta questão: desconta o tempo em que a aba ficou oculta (trocou de
  // janela/aba) e limita a 3 minutos — rede de segurança pros casos que a troca de
  // aba não pegar (ex: ficou com o site em primeiro plano mas foi fazer outra coisa
  // na mesma tela).
  const msGasto=cardMostradoEm?Math.min(Math.max(0,Date.now()-cardMostradoEm-cardTempoDescontado),TEMPO_MAX_QUESTAO):null;
  // Registrar no histórico diário
  registrarResposta(questions[ri],quality,cliqueCorreto,msGasto);
  const td=today();
  let hist=histCache;
  if(!hist[td]) hist[td]={ac:0,er:0,ms:0,mat:{}};
  if(!hist[td].mat) hist[td].mat={}; // dias salvos antes desse recurso não tinham esse campo
  if(quality===0) hist[td].er++; else hist[td].ac++;
  if(msGasto){
    hist[td].ms=(hist[td].ms||0)+msGasto;
    const materiaKey=(questions[ri].materia||'Sem matéria').trim();
    hist[td].mat[materiaKey]=(hist[td].mat[materiaKey]||0)+msGasto;
  }
  salvarHist();
  save();
  // Aviso de leech exatamente no erro que cruza o limite — uma vez só, não a cada erro
  if(quality===0&&questions[ri].erros===schedCfg().leechLimite){
    setTimeout(()=>notify(`🔥 Esta questão já tem ${questions[ri].erros} erros. Repetição não está resolvendo — provavelmente falta teoria. Veja em Banco → 🔥 Leeches.`,'err'),1000);
  }
  setTimeout(()=>{ratingLock=false;dueIdx++;updateSessBar();showCard();},900);
}
// Suspender tira da fila de revisão SEM apagar nada — o histórico fica intacto
// e você reativa quando quiser. É a alternativa a excluir uma questão problemática.
function toggleSuspensa(id){
  const i=questions.findIndex(x=>x.id===id);if(i===-1)return;
  questions[i].suspensa=!questions[i].suspensa;
  save();updateSidebar();renderBanco();
  notify(questions[i].suspensa?'Questão suspensa — sai da fila, mas continua no banco':'Questão reativada','ok');
}
function suspenderAtual(){
  const q=dueQueue[dueIdx];if(!q)return;
  const i=questions.findIndex(x=>x.id===q.id);if(i===-1)return;
  questions[i].suspensa=true;save();
  dueQueue.splice(dueIdx,1);
  updateSidebar();updateSessBar();showCard();
  notify('Questão suspensa — nada foi apagado, reative em Banco → ⏸ Suspensas','ok');
}
// Favoritar NÃO mexe no SM-2 (nextDue/interval intactos) — só dá uma leve ajuda
// de RANKING dentro do que já está vencido, em calcScore. O bônus encolhe sozinho
// conforme o ease factor sobe com os acertos (ver calcScore), então uma favorita
// dominada não segue furando fila à toa — ela só empata com as demais de novo.
function toggleFavorita(id){
  const i=questions.findIndex(x=>x.id===id);if(i===-1)return;
  questions[i].favorita=!questions[i].favorita;
  save();updateSidebar();renderBanco();
  notify(questions[i].favorita?'⭐ Questão favoritada — leve preferência na fila até o domínio consolidar':'Favorita removida','ok');
}
function favoritarAtual(){
  const q=dueQueue[dueIdx];if(!q)return;
  const i=questions.findIndex(x=>x.id===q.id);if(i===-1)return;
  questions[i].favorita=!questions[i].favorita;save();
  const btn=document.getElementById('fc-fav-btn');
  if(btn){btn.textContent=questions[i].favorita?'★':'☆';btn.style.color=questions[i].favorita?'var(--yellow-text)':'var(--muted)';btn.title=questions[i].favorita?'Remover dos favoritos':'Favoritar — leve preferência na fila, sem furar o agendamento do SM-2';}
  notify(questions[i].favorita?'⭐ Favoritada':'Favorita removida','ok');
}
function updateSessBar(){
  document.getElementById('ss-ok').textContent=sessOk;
  document.getElementById('ss-err').textContent=sessErr;
  const t=sessOk+sessErr;
  document.getElementById('ss-pct').textContent=t>0?Math.round(sessOk/t*100)+'%':'—';
  updateSessProgress();
}
function updateSessProgress(){
  const el=document.getElementById('sess-progress');if(!el)return;
  const cfg=schedCfg(),feitas=respondidasHoje(),vencidas=liveDueCount();
  const restamNaFila=Math.max(0,dueQueue.length-dueIdx);
  if(cfg.limiteDiario<=0||ignorarLimite){
    el.innerHTML=`<div style="font-size:12px;color:var(--muted);text-align:center">${feitas} respondidas hoje · ${restamNaFila} nesta sessão · ${vencidas} vencidas no total</div>`;
    return;
  }
  const pct=Math.min(100,Math.round(feitas/cfg.limiteDiario*100));
  const batida=feitas>=cfg.limiteDiario;
  el.innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:12px;margin-bottom:6px">
      <span style="color:var(--ink2);font-weight:600">Meta de hoje: <span style="font-family:'JetBrains Mono',monospace;color:${batida?'var(--green)':'var(--accent)'}">${feitas}/${cfg.limiteDiario}</span></span>
      <span style="color:var(--muted)">${restamNaFila} nesta sessão · ${vencidas} vencidas no total</span>
    </div>
    <div style="height:6px;background:var(--surface2);border-radius:3px;overflow:hidden">
      <div style="height:100%;width:${pct}%;border-radius:3px;background:${batida?'var(--green)':'linear-gradient(90deg,var(--accent),#e67e22)'};transition:width .4s"></div>
    </div>`;
}

// STATS
function setHistPeriod(days){
  const to=new Date();
  const from=new Date();
  from.setDate(from.getDate()-days+1);
  document.getElementById('hist-to').value=ymd(to);
  document.getElementById('hist-from').value=ymd(from);
  renderHistChart();
}

function renderHistChart(){
  const fromEl=document.getElementById('hist-from');
  const toEl=document.getElementById('hist-to');
  if(!fromEl.value||!toEl.value) return;
  const from=fromEl.value, to=toEl.value;
  const hist=histCache;

  // Gerar todos os dias do período
  const days=[];
  let cur=new Date(from+'T00:00:00');
  const end=new Date(to+'T00:00:00');
  // Ao digitar a data, o navegador dispara a mudança no meio da digitação, com anos
  // como 0002. Isso gerava centenas de milhares de dias e travava a página com
  // "Maximum call stack size exceeded". Período absurdo agora só mostra um aviso.
  const MAX_DIAS_GRAFICO=731;
  if(isNaN(cur)||isNaN(end)||(end-cur)/86400000>MAX_DIAS_GRAFICO){
    document.getElementById('hist-chart').innerHTML='<div style="color:var(--muted);font-size:13px;padding:20px">Escolha um período de até 2 anos</div>';
    return;
  }
  while(cur<=end){
    days.push(ymd(cur));
    cur.setDate(cur.getDate()+1);
  }

  if(!days.length){ document.getElementById('hist-chart').innerHTML='<div style="color:var(--muted);font-size:13px;padding:20px">Selecione um período válido</div>'; return; }

  // Calcular totais do período
  let totAc=0,totEr=0,totDias=0;
  days.forEach(d=>{ if(hist[d]){totAc+=hist[d].ac||0;totEr+=hist[d].er||0;totDias++;} });
  const totQ=totAc+totEr;
  const pct=totQ>0?Math.round(totAc/totQ*100):0;

  document.getElementById('hist-summary').innerHTML=`
    <div style="background:var(--surface2);border-radius:8px;padding:10px 16px;text-align:center"><div style="font-size:22px;font-weight:800;color:var(--ink);font-family:'Instrument Serif',serif">${totQ}</div><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Questões</div></div>
    <div style="background:var(--green-light);border-radius:8px;padding:10px 16px;text-align:center;border:1px solid rgba(22,163,74,.15)"><div style="font-size:22px;font-weight:800;color:var(--green);font-family:'Instrument Serif',serif">${totAc}</div><div style="font-size:11px;color:var(--green);text-transform:uppercase;letter-spacing:.5px">Acertos</div></div>
    <div style="background:var(--accent-light);border-radius:8px;padding:10px 16px;text-align:center;border:1px solid rgba(192,57,43,.15)"><div style="font-size:22px;font-weight:800;color:var(--accent);font-family:'Instrument Serif',serif">${totEr}</div><div style="font-size:11px;color:var(--accent);text-transform:uppercase;letter-spacing:.5px">Erros</div></div>
    <div style="background:var(--blue-light);border-radius:8px;padding:10px 16px;text-align:center;border:1px solid var(--blue-border)"><div style="font-size:22px;font-weight:800;color:var(--accent2);font-family:'Instrument Serif',serif">${pct}%</div><div style="font-size:11px;color:var(--accent2);text-transform:uppercase;letter-spacing:.5px">Acerto</div></div>
    <div style="background:var(--surface2);border-radius:8px;padding:10px 16px;text-align:center"><div style="font-size:22px;font-weight:800;color:var(--ink);font-family:'Instrument Serif',serif">${totDias}</div><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Dias ativos</div></div>`;

  const maxTotal=days.reduce((m,d)=>Math.max(m,hist[d]?(hist[d].ac||0)+(hist[d].er||0):0),1);
  const showLabel=days.length<=31;
  // Largura dinâmica da barra
  const barW=days.length<=14?'28px':days.length<=31?'18px':days.length<=60?'10px':'6px';

  document.getElementById('hist-chart').innerHTML=days.map(d=>{
    const ac=hist[d]?.ac||0, er=hist[d]?.er||0, tot=ac+er;
    const hAc=tot>0?Math.round(ac/maxTotal*120):0;
    const hEr=tot>0?Math.round(er/maxTotal*120):0;
    const label=d.substring(5).replace('-','/'); // MM/DD
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;flex-shrink:0;width:${barW}" title="${d}: ${ac} acertos, ${er} erros">
      ${tot>0?`<div style="font-size:9px;color:var(--muted);font-family:'JetBrains Mono',monospace">${tot}</div>`:'<div style="font-size:9px;color:transparent">0</div>'}
      <div style="display:flex;flex-direction:column;justify-content:flex-end;height:120px;width:100%;gap:1px">
        ${hAc>0?`<div style="height:${hAc}px;background:var(--green);border-radius:3px 3px 0 0;width:100%;transition:height .3s"></div>`:''}
        ${hEr>0?`<div style="height:${hEr}px;background:var(--accent);border-radius:${hAc===0?'3px 3px':0} 0;width:100%;transition:height .3s"></div>`:''}
        ${tot===0?`<div style="height:3px;background:var(--border);border-radius:3px;width:100%"></div>`:''}
      </div>
      ${showLabel?`<div style="font-size:8px;color:var(--muted);font-family:'JetBrains Mono',monospace;transform:rotate(-45deg);margin-top:4px;white-space:nowrap">${label}</div>`:''}
    </div>`;
  }).join('');

  renderTempoEstudado(days,hist);
}

// Formata ms em texto curto — min abaixo de 1h, "1h20min" a partir daí.
function fmtTempo(ms){
  const min=Math.round(ms/60000);
  if(min<60)return min+'min';
  const h=Math.floor(min/60),m=min%60;
  return m?`${h}h${m}min`:`${h}h`;
}
// Mesmo period (days/hist) do gráfico de acertos/erros acima — nasce sincronizado
// com os mesmos filtros DE/ATÉ e botões 7D/30D/90D, sem pedir nada duplicado.
function renderTempoEstudado(days,hist){
  populateHistTimeMaterias();
  const materiaFiltro=document.getElementById('hist-time-materia')?.value||'';
  // Com filtro: olha só hist[d].mat[materiaFiltro] em vez do total do dia.
  const msDoDia=d=>materiaFiltro?(hist[d]?.mat?.[materiaFiltro]||0):(hist[d]?.ms||0);
  let totMs=0,diasComTempo=0;
  const matTot={};
  days.forEach(d=>{
    const ms=msDoDia(d);
    if(ms>0){totMs+=ms;diasComTempo++;}
    const mat=hist[d]?.mat;
    if(mat)Object.entries(mat).forEach(([m,v])=>{matTot[m]=(matTot[m]||0)+v;});
  });
  const hojeMs=msDoDia(today());
  const mediaMs=diasComTempo>0?totMs/diasComTempo:0;
  document.getElementById('hist-time-summary').innerHTML=`
    <div style="background:var(--surface2);border-radius:8px;padding:10px 16px;text-align:center"><div style="font-size:22px;font-weight:800;color:var(--ink);font-family:'Instrument Serif',serif">${fmtTempo(totMs)}</div><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">No período</div></div>
    <div style="background:var(--blue-light);border-radius:8px;padding:10px 16px;text-align:center;border:1px solid var(--blue-border)"><div style="font-size:22px;font-weight:800;color:var(--accent2);font-family:'Instrument Serif',serif">${fmtTempo(mediaMs)}</div><div style="font-size:11px;color:var(--accent2);text-transform:uppercase;letter-spacing:.5px">Média/dia ativo</div></div>
    <div style="background:var(--green-light);border-radius:8px;padding:10px 16px;text-align:center;border:1px solid rgba(22,163,74,.15)"><div style="font-size:22px;font-weight:800;color:var(--green);font-family:'Instrument Serif',serif">${fmtTempo(hojeMs)}</div><div style="font-size:11px;color:var(--green);text-transform:uppercase;letter-spacing:.5px">Hoje</div></div>`;

  const maxMs=days.reduce((m,d)=>Math.max(m,msDoDia(d)),1);
  const showLabel=days.length<=31;
  const barW=days.length<=14?'28px':days.length<=31?'18px':days.length<=60?'10px':'6px';
  document.getElementById('hist-time-chart').innerHTML=days.map(d=>{
    const ms=msDoDia(d);
    const h=ms>0?Math.max(3,Math.round(ms/maxMs*120)):0;
    const label=d.substring(5).replace('-','/');
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;flex-shrink:0;width:${barW}" title="${d}: ${fmtTempo(ms)}">
      ${ms>0?`<div style="font-size:9px;color:var(--muted);font-family:'JetBrains Mono',monospace">${Math.round(ms/60000)}</div>`:'<div style="font-size:9px;color:transparent">0</div>'}
      <div style="display:flex;flex-direction:column;justify-content:flex-end;height:120px;width:100%">
        <div style="height:${h||3}px;background:${ms>0?'var(--accent2)':'var(--border)'};border-radius:3px;width:100%;transition:height .3s"></div>
      </div>
      ${showLabel?`<div style="font-size:8px;color:var(--muted);font-family:'JetBrains Mono',monospace;transform:rotate(-45deg);margin-top:4px;white-space:nowrap">${label}</div>`:''}
    </div>`;
  }).join('');

  // Com uma matéria específica selecionada, o ranking (que soma TODAS as matérias)
  // vira redundante/confuso ao lado dos cards já filtrados — esconde nessa hora.
  const wrap=document.getElementById('hist-time-mat-wrap');
  if(materiaFiltro){wrap.style.display='none';}
  else{
    wrap.style.display='block';
    const matsSorted=Object.entries(matTot).sort((a,b)=>b[1]-a[1]).slice(0,7);
    const maxMat=Math.max(...matsSorted.map(([,v])=>v),1);
    document.getElementById('hist-time-mat').innerHTML=matsSorted.length?matsSorted.map(([nm,v])=>{
      const w=Math.round(v/maxMat*100);
      return `<div class="mat-row"><div class="mat-row-h"><span class="mat-name">${esc(nm)}</span><span class="mat-pct">${fmtTempo(v)}</span></div><div class="prog-bar"><div class="prog-fill" style="width:${w}%;background:var(--accent2)"></div></div></div>`;
    }).join(''):'<div style="color:var(--muted);font-size:13px">Sem dados de tempo ainda neste período</div>';
  }
}

// PAINEL DE AGENDAMENTO
const SCHED_PRESETS=[
  {nome:'Anki puro',im:1.00,desc:'100%'},
  {nome:'Um pouco mais espaçado',im:1.20,desc:'120%'},
  {nome:'Bem mais espaçado',im:1.50,desc:'150%'}
];
const EDITAL=[{"n":"Legislação Tributária Municipal","p":"I","pts":20,"sR":1401,"sA":1084,"m":["LTM (Manaus)","Legislação Tributária dos Municípios","Direito Tributário Municipal"]},{"n":"Língua Portuguesa","p":"I","pts":10,"sR":109,"sA":89,"m":["Língua Portuguesa (Português)"]},{"n":"Direito Civil e Empresarial","p":"I","pts":8,"sR":0,"sA":0,"m":["Direito Civil","Direito Empresarial (Comercial)"]},{"n":"Contabilidade Geral","p":"I","pts":7.5,"sR":494,"sA":389,"m":["Contabilidade","Contabilidade Geral","Contabilidade de Custos"]},{"n":"Economia","p":"I","pts":7.5,"sR":633,"sA":453,"m":["Economia e Finanças Públicas"]},{"n":"Direito Penal e Processual Penal","p":"I","pts":7,"sR":200,"sA":150,"m":["Direito Penal","Direito Processual Penal"]},{"n":"Inglês Instrumental","p":"I","pts":5,"sR":0,"sA":0,"m":["Língua Inglesa (Inglês)"]},{"n":"Direito Administrativo","p":"I","pts":5,"sR":341,"sA":280,"m":["Direito Administrativo","Direito Administrativo (Doutrina e Leis Federais)"]},{"n":"Direito Constitucional","p":"I","pts":5,"sR":578,"sA":470,"m":["Direito Constitucional","Direito Constitucional (CF/1988 e Doutrina)","Direito Constitucional Municipal"]},{"n":"Direito Processual Civil","p":"I","pts":5,"sR":0,"sA":0,"m":["Direito Processual Civil"]},{"n":"Matemática Financeira","p":"I","pts":3.33,"sR":88,"sA":76,"m":["Matemática Financeira"]},{"n":"Raciocínio Lógico","p":"I","pts":3.33,"sR":63,"sA":49,"m":["Raciocínio Lógico"]},{"n":"Estatística","p":"I","pts":3.33,"sR":3,"sA":1,"m":["Estatística"]},{"n":"Direito Tributário e Legislação Tributária Nacional","p":"II","pts":60,"sR":1184,"sA":935,"m":["Direito Tributário","Reforma Tributária","Legislação Tributária Federal","Legislação Tributária dos Estados e do Distrito Federal"]},{"n":"Auditoria","p":"II","pts":45,"sR":324,"sA":281,"m":["Auditoria Privada","Auditoria Governamental e Controle"]},{"n":"Banco de Dados e Linguagem SQL","p":"II","pts":30,"sR":222,"sA":153,"m":["Banco de Dados","TI - Banco de Dados"]},{"n":"Governança de Dados e Segurança da Informação","p":"II","pts":30,"sR":136,"sA":95,"m":["LGPD","Segurança da Informação","Governança de Dados","TI - Segurança da Informação","Direito Digital","TI - Ciência de Dados e Inteligência Artificial"]},{"n":"Legislação Tributária (Zona Franca de Manaus)","p":"II","pts":30,"sR":0,"sA":0,"m":["Zona Franca de Manaus","Legislação Aduaneira"]},{"n":"Análise das Demonstrações Contábeis","p":"II","pts":15,"sR":0,"sA":0,"m":["Análise de Demonstrações Contábeis"]}];
const META_PADRAO={alvo:0.80,pisoProva:0.60};
// Matéria vazia ("") não conta como fora do edital — é questão sem matéria
// identificada (falha de import), não questão de outro concurso; suspender ela
// escondia um problema de parsing em vez de mostrar.
const MATS_EDITAL=new Set(EDITAL.flatMap(d=>d.m));
function materiaForaDoEdital(m){m=(m||'').trim();return m!==''&&!MATS_EDITAL.has(m);}

// ===== UNIFICAÇÃO DE MATÉRIAS DUPLICADAS =====
// Questões de editais diferentes às vezes chegam com nomes de matéria diferentes
// para o mesmo assunto (ex.: "Segurança da Informação" x "TI - Segurança da
// Informação", vindas de provas distintas do TecConcursos). Isso não afeta o SM-2
// (é por questão, via id) nem o peso na fila (o EDITAL já trata as duas variantes
// como a mesma coisa) — só faz o nome aparecer duplicado nos filtros e separa as
// estatísticas de erro por assunto à toa. Esta função troca o nome antigo pelo
// definitivo em TODO lugar que guarda matéria como texto solto: banco de questões,
// resumos e o histórico de tempo estudado por dia.
const MATERIAS_UNIFICAR={
  'Segurança da Informação':'TI - Segurança da Informação',
  'Direito Constitucional':'Direito Constitucional (CF/1988 e Doutrina)',
  'Direito Administrativo':'Direito Administrativo (Doutrina e Leis Federais)',
  'Contabilidade':'Contabilidade Geral',
  'Banco de Dados':'TI - Banco de Dados'
};
function unificarMaterias(mapa){
  mapa=mapa||MATERIAS_UNIFICAR;
  const origens=Object.keys(mapa);
  if(!origens.length)return{questoes:0,resumos:0,dias:0};
  let nQuestoes=0;
  questions.forEach(q=>{
    const atual=(q.materia||'').trim();
    if(mapa[atual]){q.materia=mapa[atual];nQuestoes++;}
  });
  let nResumos=0;
  resumos.forEach(r=>{
    const atual=(r.materia||'').trim();
    if(mapa[atual]){r.materia=mapa[atual];nResumos++;}
  });
  let nDias=0;
  Object.values(histCache).forEach(h=>{
    if(!h||!h.mat)return;
    let mudouEsteDia=false;
    origens.forEach(origem=>{
      if(!(origem in h.mat))return;
      const destino=mapa[origem];
      h.mat[destino]=(h.mat[destino]||0)+h.mat[origem];
      delete h.mat[origem];
      mudouEsteDia=true;
    });
    if(mudouEsteDia)nDias++;
  });
  // Chip personalizado com o nome antigo também é atualizado, senão ele continua
  // oferecendo a matéria descontinuada na hora de gerar questão nova.
  const custom=getCustomChips();
  let mudouChips=false;
  const customNovo=custom.map(c=>{
    if(mapa[c.value]){mudouChips=true;return{...c,value:mapa[c.value],label:c.label};}
    return c;
  }).filter((c,i,arr)=>arr.findIndex(x=>x.value===c.value)===i); // remove duplicata se o destino já existia como chip
  if(mudouChips)saveCustomChips(customNovo);
  if(nQuestoes)save();
  if(nResumos)saveResumos();
  if(nDias)salvarHist();
  renderMateriaChips();updateMateriaDatalist();
  if(document.getElementById('banco-list'))renderBanco();
  if(document.getElementById('f-estudar-materia'))populateEstudarMaterias();
  if(document.getElementById('f-resumo-materia'))renderResumos();
  if(document.getElementById('hist-time-materia'))populateHistTimeMaterias();
  updateSidebar();
  return{questoes:nQuestoes,resumos:nResumos,dias:nDias};
}

// ===== SCORE DE PRIORIDADE DA FILA =====
// Três sinais em pé de igualdade, cada um normalizado pra 0..1 antes da média —
// nenhum manda mais que o outro:
//   1) atraso do SM-2 (o quanto já venceu)
//   2) importância = peso da disciplina no edital (EDITAL[].pts) MULTIPLICADO pela
//      fatia que o subtema representa dentro da própria matéria (banca real). Um
//      subtema que é só 1% das questões de banca daquela matéria não deve valer
//      quase o mesmo que um que é 40% dela, mesmo as duas sendo a mesma disciplina
//      de peso alto — multiplicar (em vez de somar/tirar média) é o que de fato
//      derruba o de 1%, não só amacia.
//   3) taxa de erro histórica NO ASSUNTO (matéria+subtema, não só da questão em si —
//      isso deixa até uma questão nova herdar a dificuldade real do conceito)
// Antes a fila só olhava atraso e intercalava por CONTAGEM de grupo — um assunto
// com banco enorme dominava a sessão só por volume, não por importância real.
const PESO_MAX_EDITAL=Math.max(...EDITAL.map(d=>d.pts));
function pesoDaMateria(materia){
  const m=(materia||'').trim();
  const d=EDITAL.find(d=>d.m.includes(m));
  // Fora do edital (matéria "órfã", não mapeada em nenhum bloco de prova):
  // peso médio-baixo — não some da fila, mas também não briga à toa com o que pontua.
  return d?d.pts/PESO_MAX_EDITAL:0.4;
}
// Recalculado uma vez por chamada de initStudy (não por questão) — o banco tem
// milhares de linhas e o mapa é o mesmo pras 'novas' e pras 'velhas' da sessão.
// Um único laço mede, por assunto (matéria+subtema):
//   - taxa de erro histórica (pilar "erro")
//   - fatia de banca REAL que aquele subtema representa DENTRO DA PRÓPRIA MATÉRIA
//     (pilar "importância", junto do peso do edital)
// Só conta fonte==='tec': questão gerada por IA não é evidência de "isso cai muito
// na prova", é só evidência de "você decidiu gerar mais sobre isso".
// ===== CURVA DE ESFORÇO MARGINAL + CONFIANÇA POR AMOSTRA =====
// Duas ideias numa curva só:
//  1) Marginal: subir de 40% pra 41% de acerto custa menos esforço que subir de
//     80% pra 81% — perto do teto cada ponto fica mais caro. Isso pesa a favor de
//     manter prioridade em assuntos que já vão bem, não só nos que vão mal.
//  2) Confiança por amostra: 100% de acerto em 9 respostas não é a mesma certeza
//     que 100% em 90. Com poucas respostas, a taxa observada é encolhida em
//     direção a 50% (o "não sei ainda") antes de entrar na curva — senão um
//     assunto pouco testado e por acaso acertado vira invisível na fila cedo
//     demais (foi o que aconteceu com Auditoria: 100% em 9 respostas).
const CONF_K=8; // "peso" de 8 respostas fictícias em 50% — abaixo disso, o encolhimento domina
function taxaErroAjustada(ac,er){
  const resp=ac+er;
  if(resp===0)return 0.5; // sem dado nenhum: neutro
  const bruta=er/resp;
  const encolhida=(bruta*resp+0.5*CONF_K)/(resp+CONF_K);
  const dist=Math.abs(encolhida-0.5)*2; // 0 no meio, 1 nas pontas
  return 0.5+(encolhida-0.5)*(1+dist); // estica os extremos, sem inverter o sinal
}
// A qual DISCIPLINA do edital a matéria pertence. É o mesmo casamento que
// pesoDaMateria() faz; aqui devolve o nome, para servir de chave de agrupamento.
function disciplinaDaMateria(materia){
  const d=EDITAL.find(d=>d.m.includes((materia||'').trim()));
  return d?d.n:'(fora do edital)';
}
// A fatia responde "o quanto este subtema representa do que a banca cobra".
// Ela era medida DENTRO DA MATÉRIA e em valor absoluto — e isso tinha dois
// defeitos que só apareceram com o banco grande:
//
//  1) GRANULARIDADE. Como a soma das fatias de uma matéria é sempre 1, a fatia
//     média vale 1/nº de subtemas. Então o score de uma questão acabava
//     INVERSAMENTE PROPORCIONAL a quão fina estava a taxonomia daquela matéria —
//     que é decisão de catalogação, não de estudo. Medido: "Direito
//     Constitucional Municipal" tinha 1 subtema só (Lei Orgânica), fatia 1,00, e
//     ganhava de Contabilidade Geral (51 subtemas, fatia ~0,02) por 5 a 13×,
//     apesar de valer MENOS pontos no edital. Resultado real em 7 dias: 124
//     respostas de Lei Orgânica contra 5 de Contabilidade Geral.
//
//  2) MATÉRIA ≠ DISCIPLINA. O peso vem da disciplina do edital, mas o
//     denominador era a matéria. Uma disciplina partida em várias matérias tinha
//     os denominadores fragmentados, e a parte mais estreita ganhava de lavada da
//     mais larga — "Municipal" contra "CF/1988 e Doutrina", mesmos 5 pontos, ~20×
//     de diferença no subtema mediano.
//
// Agora a fatia é medida dentro da DISCIPLINA e normalizada pela média dela
// (× nº de subtemas): 1,00 passa a significar "subtema médio desta disciplina",
// acima de 1 é mais cobrado que a média, abaixo é menos. Três consequências:
//   - o nº de subtemas some da conta, que é o defeito (1);
//   - o denominador vira a disciplina, que é o defeito (2);
//   - o fallback ": 1" (matéria sem nenhuma questão de banca) deixa de ser o TETO
//     e passa a ser o neutro, que é o que o comentário antigo já dizia querer.
// A comparação DENTRO de cada matéria não muda: a transformação é o mesmo fator
// constante para todos os subtemas dela. Conferido no banco de 22/09 — a ordem
// interna ficou idêntica nas 28 matérias ativas.
function estatisticasPorAssunto(){
  const porAssunto=new Map();   // materia§subtema -> {ac,er,banca}
  const porMateria=new Map();   // materia -> total de banca real
  const porDisciplina=new Map();// disciplina do edital -> total de banca real
  const subsDaDisciplina=new Map(); // disciplina -> Set de assuntos COM banca
  questions.forEach(q=>{
    const materia=(q.materia||'—').trim(), subtema=(q.subtema||'—').trim();
    const k=materia+'§'+subtema;
    const o=porAssunto.get(k)||{ac:0,er:0,banca:0};
    o.ac+=q.acertos||0;o.er+=q.erros||0;
    if(q.fonte==='tec'){
      o.banca++;
      porMateria.set(materia,(porMateria.get(materia)||0)+1);
      const disc=disciplinaDaMateria(materia);
      porDisciplina.set(disc,(porDisciplina.get(disc)||0)+1);
      if(!subsDaDisciplina.has(disc))subsDaDisciplina.set(disc,new Set());
      subsDaDisciplina.get(disc).add(k);
    }
    porAssunto.set(k,o);
  });
  const out=new Map();
  porAssunto.forEach((o,k)=>{
    const materia=k.split('§')[0];
    const totalMateria=porMateria.get(materia)||0;
    const disc=disciplinaDaMateria(materia);
    const totalDisc=porDisciplina.get(disc)||0;
    const nSubs=(subsDaDisciplina.has(disc)?subsDaDisciplina.get(disc).size:0)||1;
    out.set(k,{
      taxaErro: taxaErroAjustada(o.ac,o.er),
      // Sem banca, a fatia é NEUTRA (1 = subtema médio da disciplina), nunca 0.
      // Zero seria a afirmação "a banca nunca cobra isto" — e o que existe é
      // AUSÊNCIA DE EVIDÊNCIA, não evidência de ausência. A diferença não é
      // acadêmica: como o score é multiplicativo, um subtema só de IA dentro de
      // uma matéria que tem banca recebia score exatamente 0 e ia para o fim
      // absoluto da fila, por mais que fosse errado. Medido no banco de 23/09:
      // 162 assuntos e 614 questões nessa situação, com 1.894 respostas e erros
      // de até 78% (Recursos, Proc. Civil), 46% (Prazos médios e giro), 45%
      // (Comandos DDL) — exatamente os assuntos que foram criados PORQUE erravam.
      fatiaMateria: (totalMateria>0&&totalDisc>0&&o.banca>0)?(o.banca/totalDisc)*nSubs:1
    });
  });
  return out;
}
// Favorita dá uma AJUDA DE DESEMPATE dentro do que já está vencido — não força
// entrada na fila nem mexe no SM-2 (nextDue continua exatamente o calculado pelo
// sm2()). O bônus é proporcional ao INVERSO do domínio: mesma escala 0..1 que as
// pips de "Facilidade" usam (ef vai de 1,3 a 3,0). Questão nova/difícil favorita
// ganha o bônus cheio; conforme os acertos sobem o ease factor, o bônus encolhe
// e, com o domínio consolidado, a questão volta a competir só pelos três sinais
// normais — exatamente o "mesmo padrão que as demais" pedido.
// ===== SCORE DE PRIORIDADE — PESO DO EDITAL MANDA, ERRO MODULA =====
// Antes: (atraso + importância + erro) / 3 — os três pesavam igual, então um
// erro extremo numa matéria de peso baixo (ex.: Economia, 0,125) conseguia
// competir de igual pra igual com uma matéria de peso alto (Auditoria, 0,75).
// Agora PESO DO EDITAL domina o score. Erro e atraso só multiplicam esse peso
// pra cima ou pra baixo — nunca o substituem. Uma matéria de peso 0,125 no teto
// de erro rende no máximo 0,125*1,5=0,19 de score-base; uma matéria de peso 0,75
// com erro mediano já rende 0,75*1,0=0,75 — muito maior, do jeito que devia ser,
// porque é assim que a prova pondera.
// ===== BÔNUS DE TENDÊNCIA (03/10) =====
// Dois multiplicadores sobre o score, sem tocar no SM-2 nem no peso do edital:
//  1) PROVA FISCAL RECENTE: questão de banca de concurso fiscal de 2025 em diante.
//     Medido no banco de 01/10: o enunciado mediano da FCC foi de ~260 caracteres
//     (até 2022) para 504 (2026) e o caso prático de 5% para 11% — em Direito
//     Tributário, de 214 para 551. É o padrão que a prova de 01/11 deve repetir.
//     O ano não é campo da questão; o id do TEC cresce com o tempo e 3.300.000 é
//     onde começam as provas de 2025.
//  2) REFORMA TRIBUTÁRIA: nas provas fiscais da FCC de 2026 a reforma foi mais da
//     metade das questões de tributário que estão no banco (SEFAZ CE 21 de 34, GO 9
//     de 16, MT 8 de 14), mas é só 23% do bloco aqui. Vale para a matéria "Reforma
//     Tributária" e para os assuntos de LC 214, LC 227, EC 132, IBS, CBS e Imposto
//     Seletivo que o TEC classifica em Direito Tributário e Legislação Federal.
// Os dois se acumulam (1,3 × 1,5 = 1,95 para questão de reforma de prova fiscal de
// 2026). Para desligar, ponha 1 nas duas constantes.
const BONUS_PROVA_FISCAL_RECENTE=1.3;
const BONUS_REFORMA=2.0;
const ID_TEC_INICIO_2025=3300000, ID_TEC_TETO=9000000;
const RE_ORIGEM_FISCAL=/SEFAZ|SEFA |SEF SC|SEFIN|SER PB|Auditor Fiscal|Fiscal de (Tributos|Rendas|Receitas)|Agente (Fiscal|de Tributos)|Receita Estadual/i;
const RE_ASSUNTO_REFORMA=/Complementar n?[ºo°.]*\s*(214|227)|LC n?[ºo°.]*\s*(214|227)|Constitucional n?[ºo°.]*\s*132|EC n?[ºo°.]*\s*132|\bIBS\b|\bCBS\b|Imposto Seletivo|Comitê Gestor|Reforma Tributária/i;
function ehProvaFiscalRecente(q){
  return q.fonte==='tec'&&typeof q.id==='number'&&q.id>=ID_TEC_INICIO_2025&&q.id<ID_TEC_TETO&&RE_ORIGEM_FISCAL.test(q.origem||'');
}
function ehReformaTributaria(q){
  const m=(q.materia||'').trim();
  if(m==='Reforma Tributária')return true;
  if(m!=='Direito Tributário'&&m!=='Legislação Tributária Federal')return false;
  return RE_ASSUNTO_REFORMA.test(q.subtema||'');
}
// ===== ASSUNTOS COM COBRANÇA FISCAL RECENTE (03/10) =====
// Chave "matéria§subtema" -> em quantas provas fiscais da FCC de 2021 em diante o
// assunto apareceu. Contagem conferida prova a prova no TEC em 03/10, em 13 provas:
// SEFAZ CE, GO, MT, SP (Gestão Tributária), PI (Auditor, Agente e Tesouro), PE, AP
// (Auditor e Fiscal), SEF SC (Analista), ISS Jaboatão e ISS Barueri. Onde o TEC
// classifica o assunto em outra matéria, vale a contagem tirada do próprio banco. Vale para TODA questão do assunto, não só
// para as dessas provas: é o assunto que tem cara de prova fiscal.
//   · assunto no mapa: +10% por prova, até +50% (5 provas ou mais);
//   · matéria mapeada, questão de banca, assunto fora do mapa: -20% (não some,
//     só vai para depois). Questão de IA não é rebaixada: os subtemas dela têm
//     nome próprio e não casam com a árvore do TEC.
// Matérias mapeadas até aqui: Direito Tributário, Legislação Tributária Federal,
// Reforma Tributária, Contabilidade Geral e Economia. As demais ficam neutras (1).
const ASSUNTOS_FISCAIS={"Contabilidade Geral§Ativo Imobilizado (Conceito, Classificação, Mensuração Inicial, Reavaliação)": 3, "Contabilidade Geral§Ativos Intangíveis (CPC 04, Lei 6.404)": 3, "Contabilidade Geral§Ações (Ágio na Emissão, Reembolso, Resgate, Amortização, Gastos na Emissão)": 1, "Contabilidade Geral§Balanço Patrimonial": 3, "Contabilidade Geral§CPC 06: Arrendamento Mercantil (Financeiro e Operacional)": 3, "Contabilidade Geral§CPC 16 - Tratamento Contábil para os Estoques": 4, "Contabilidade Geral§Capital Social (Subscrito, a Realizar, Realizado)": 1, "Contabilidade Geral§Critérios de Avaliação do Estoque (PEPS, UEPS, Média Ponderada)": 1, "Contabilidade Geral§Debêntures e Títulos de Dívida": 2, "Contabilidade Geral§Decreto nº 6.022/2007 - Sistema Público de Escrituração Digital (SPED)": 1, "Contabilidade Geral§Demonstração de Fluxo de Caixa (DFC - CPC 03, Lei 6.404, art. 188, I)": 9, "Contabilidade Geral§Demonstração de Resultados Abrangentes (DRA)": 2, "Contabilidade Geral§Demonstração do Resultado do Exercício (DRE) e Destinação do Resultado": 6, "Contabilidade Geral§Demonstração do Valor Adicionado (DVA - CPC 09, Lei 6.404, art. 188, II)": 7, "Contabilidade Geral§Depreciação, Amortização e Exaustão": 6, "Contabilidade Geral§Elaboração e Apresentação das Demonstrações Contábeis (CPC 26, Lei 6.404, arts. 176 e 177)": 2, "Contabilidade Geral§Empréstimos e Fornecedores": 7, "Contabilidade Geral§Estrutura Conceitual Básica da Contabilidade (CPC 00)": 2, "Contabilidade Geral§Goodwill": 2, "Contabilidade Geral§Instrumentos Financeiros": 10, "Contabilidade Geral§Investimentos Avaliados pelo Custo ou MEP (CPC 18, Lei 6.404, art. 248)": 9, "Contabilidade Geral§Operações com Mercadorias (CMV, RCM, Tributos, Frete, etc.)": 3, "Contabilidade Geral§Propriedades para Investimento (CPC 28)": 3, "Contabilidade Geral§Provisões, Passivos e Ativos Contingentes (CPC 25, Lei 6.404)": 11, "Contabilidade Geral§Redução ao Valor Recuperável de Ativos (CPC 01, Lei 6.404, art. 183, §3º, I)": 11, "Contabilidade Geral§Regimes Contábeis (Competência, Caixa e Misto)": 1, "Contabilidade Geral§Reserva de Reavaliação (Extinta)": 1, "Contabilidade Geral§Reservas de Capital": 1, "Contabilidade Geral§Reservas de Lucros": 6, "Direito Tributário§Comitê Gestor do IBS (CF 1988, EC 132)": 1, "Direito Tributário§Competência Tributária: Conceitos e Características": 4, "Direito Tributário§Contribuições Especiais (CF/1988)": 1, "Direito Tributário§Contribuições de Melhoria (CF/1988 e CTN)": 2, "Direito Tributário§Disposições Finais e Transitórias do CTN (arts. 209 a 218)": 1, "Direito Tributário§Disposições Gerais da Legislação (arts. 96 a 100 do CTN)": 2, "Direito Tributário§Disposições Gerais do Crédito Tributário (arts. 139 a 141 do CTN)": 1, "Direito Tributário§Disposições Gerais sobre Obrigação Tributária (Conceito, Obrigação Principal e Acessória)": 1, "Direito Tributário§Empréstimo Compulsório (CF/1988 e CTN)": 2, "Direito Tributário§Espécies Normativas Aplicadas ao Direito Tributário (art. 146 e 146-A da CF/1988)": 1, "Direito Tributário§Exclusão do Crédito Tributário (arts. 175 a 182 do CTN)": 2, "Direito Tributário§Extinção do Crédito Tributário (arts. 156 a 174 do CTN)": 8, "Direito Tributário§Fiscalização Tributária (arts. 194 a 200 do CTN)": 2, "Direito Tributário§Garantias e Privilégios do Crédito Tributário (arts. 183 a 193 do CTN)": 1, "Direito Tributário§Imposto Predial e Territorial Urbano - IPTU (CF/1988 e CTN)": 1, "Direito Tributário§Imposto Seletivo - IS (CF 1988; EC 132)": 1, "Direito Tributário§Imposto de Transmissão Causa Mortis e Doação - ITCMD (CF/1988 e CTN)": 3, "Direito Tributário§Imposto sobre Bens e Serviços - IBS (CF/1988, EC 132)": 3, "Direito Tributário§Imposto sobre Circulação de Mercadorias e Serviços - ICMS (CF/1988 e CTN)": 2, "Direito Tributário§Imposto sobre Operações Financeiras - IOF": 1, "Direito Tributário§Imposto sobre Propriedade de Veículos Automotores - IPVA (CF/1988 e CTN)": 3, "Direito Tributário§Imposto sobre Transmissão de Bens Imóveis - ITBI (CF/1988 e CTN)": 1, "Direito Tributário§Interpretação e Integração da Legislação Tributária (arts. 107 a 112 do CTN)": 3, "Direito Tributário§Jurisprudência dos Tribunais Superiores sobre ISS": 1, "Direito Tributário§Jurisprudência dos Tribunais Superiores sobre Imunidades Tributárias": 1, "Direito Tributário§Jurisprudência dos Tribunais Superiores sobre Lançamento e Constituição do Crédito Tributário": 1, "Direito Tributário§Jurisprudência dos Tribunais Superiores sobre Legislação Tributária": 1, "Direito Tributário§Jurisprudência dos Tribunais Superiores sobre Taxas, Preços Públicos e Pedágio": 2, "Direito Tributário§Lançamento e Constituição do Crédito Tributário (arts. 142 a 150 do CTN)": 5, "Direito Tributário§Lei Complementar nº 105/2001 - Sigilo das Operações de Instituições Financeiras": 4, "Direito Tributário§Lei nº 12.016/2009 - Mandado de Segurança em Matéria Tributária": 1, "Direito Tributário§Lei nº 6.830/1980 - Lei de Execução Fiscal": 1, "Direito Tributário§Outras Questões e Tópicos Mesclados sobre a Reforma Tributária": 1, "Direito Tributário§Princípios Tributários": 4, "Direito Tributário§Questões Mescladas de Espécies de Tributos": 1, "Direito Tributário§Repartição da Competência Tributária (Privativa, Comum, Cumulativa, Residual, Extraordinária e Compartilhada)": 2, "Direito Tributário§Responsabilidade Tributária (arts. 128 a 138 do CTN)": 7, "Direito Tributário§Solidariedade (arts. 124 e 125 do CTN)": 1, "Direito Tributário§Sujeito: Ativo e Passivo (arts. 119 a 123 do CTN)": 1, "Direito Tributário§Suspensão da Exigibilidade do Crédito Tributário (arts. 151 a 155-A do CTN)": 2, "Direito Tributário§Taxas (CF/1988 e CTN)": 2, "Direito Tributário§Tópicos Mesclados de Extinção, Exclusão e Suspensão do Crédito Tributário": 3, "Direito Tributário§Vigência e Aplicação da Legislação Tributária (arts. 101 a 106 do CTN)": 4, "Economia e Finanças Públicas§Balanço de Pagamentos": 2, "Economia e Finanças Públicas§Bem Estar e Funções do Governo": 2, "Economia e Finanças Públicas§Bens Públicos (Economia)": 2, "Economia e Finanças Públicas§Conceito de Economia": 1, "Economia e Finanças Públicas§Concorrência Perfeita": 2, "Economia e Finanças Públicas§Curva Reversa (de Laffer)": 2, "Economia e Finanças Públicas§Demanda e Oferta": 1, "Economia e Finanças Públicas§Dívida Pública, NFSP e Tipos de Déficit Público no Brasil": 3, "Economia e Finanças Públicas§Economia Fechada": 3, "Economia e Finanças Públicas§Elasticidade Preço da Demanda": 3, "Economia e Finanças Públicas§Externalidades": 4, "Economia e Finanças Públicas§Federalismo Fiscal": 2, "Economia e Finanças Públicas§Incidência Tributária - Impacto da Carga Tributária sobre a Economia": 4, "Economia e Finanças Públicas§Inflação": 2, "Economia e Finanças Públicas§Modelo Keynesiano": 3, "Economia e Finanças Públicas§Modelo de Oferta e Demanda Agregada (OA-DA) de Determinação da Renda e dos Preços": 1, "Economia e Finanças Públicas§Monopólio": 2, "Economia e Finanças Públicas§Princípios Teóricos da Tributação": 3, "Economia e Finanças Públicas§Produto Nominal X Produto Real (Deflator do PIB)": 2, "Economia e Finanças Públicas§Tipos de Estrutura": 1, "Legislação Tributária Federal§Alíquota, Base de Cálculo e Valor a Ser Pago (arts. 7º e 8º-A da LC nº 116/2003)": 2, "Legislação Tributária Federal§Da Base de Cálculo (arts. 12 e 13 da LC nº 214/2025)": 2, "Legislação Tributária Federal§Da Definição de Microempresa e de Empresa de Pequeno Porte (arts. 3º a 3º-B da LC nº 123/2006)": 3, "Legislação Tributária Federal§Da Imunidade e da Não Incidência do ITCMD (arts. 149 e 150 da LC nº 227/2026)": 1, "Legislação Tributária Federal§Da Sujeição Passiva (arts. 21 a 26 da LC nº 214/2025)": 4, "Legislação Tributária Federal§Das Alíquotas (arts. 14 a 20 da LC nº 214/2025)": 1, "Legislação Tributária Federal§Das Competências do CGIBS e das Diretrizes para a Coordenação da Fiscalização e da Cobrança do IBS (arts. 2º a 6º da LC nº 227/2026)": 1, "Legislação Tributária Federal§Das Disposições Preliminares (arts. 1º e 2º da LC nº 123/2006)": 1, "Legislação Tributária Federal§Das Hipóteses de Incidência (arts. 4º a 7º da LC nº 214/2025)": 1, "Legislação Tributária Federal§Das Modalidades de Extinção dos Débitos (arts. 27 a 37 da LC nº 214/2025)": 2, "Legislação Tributária Federal§Das Normas Processuais (arts. 54 a 66 da LC nº 227/2026)": 1, "Legislação Tributária Federal§Disposições Preliminares (arts. 1º a 3º da LC nº 214/2025)": 2, "Legislação Tributária Federal§Do Comitê Gestor do IBS (arts. 480 a 484 da LC nº 214/2025)": 2, "Legislação Tributária Federal§Do IBS e da CBS sobre Exportações (arts. 79 a 83 da LC nº 214/2025)": 1, "Legislação Tributária Federal§Do IBS e da CBS sobre Importações (arts. 63 a 78 da LC nº 214/2025)": 1, "Legislação Tributária Federal§Do Local da Operação (art. 11 da LC nº 214/2025)": 3, "Legislação Tributária Federal§Do Momento de Ocorrência do Fato Gerador (art. 10 da LC nº 214/2025)": 3, "Legislação Tributária Federal§Dos Contribuintes e da Sujeição Ativa (arts. 157 a 159 da LC nº 227/2026)": 1, "Legislação Tributária Federal§Dos Tributos e Contribuições (arts. 12 a 41 da LC nº 123/2006)": 7, "Legislação Tributária Federal§Fato Gerador e Hipóteses de Não Incidência (arts. 1º e 2º da LC nº 116/2003)": 4, "Legislação Tributária Federal§Resolução CGSN nº 140/2018 - Regime Especial Unificado de Arrecadação de Tributos e Contribuições devidos pelas ME e EPP (Simples Nacional)": 3, "Legislação Tributária Federal§Sujeito Passivo e Local da Operação e Prestação (arts. 3º a 6º da LC nº 116/2003)": 2, "Reforma Tributária§Emenda Constitucional nº 132/2023 (arts. 6º a 23) - Reforma Tributária": 2};
const MATERIAS_COM_MAPA_FISCAL=new Set(Object.keys(ASSUNTOS_FISCAIS).map(k=>k.split('§')[0]));
const FATOR_POR_PROVA_FISCAL=0.10, TETO_PROVAS_FISCAIS=5, FATOR_FORA_DO_PERFIL=0.8;
// Assuntos que não caíram nessas provas mas estão LITERALMENTE na ementa de Manaus
// (bloco de Economia do Anexo III): ficam neutros, sem bônus e sem rebaixamento.
const ASSUNTOS_NEUTROS_EDITAL=new Set(['Conceitos e Identidades Macroeconômicos','Teoria Quantitativa da Moeda','Concorrência Monopolística','Escassez, Escolha e Custo de Oportunidade','Modelo de Solow','Crescimento Endógeno e Outros Modelos','Política Fiscal','Política Monetária','Regimes Cambiais','Informações Assimétricas','Elasticidade Preço da Oferta','Funções e Atributos da Moeda','Curva de Possibilidades de Produção'].map(x=>'Economia e Finanças Públicas§'+x));
function fatorAssuntoFiscal(q){
  const m=(q.materia||'').trim();
  if(!MATERIAS_COM_MAPA_FISCAL.has(m))return 1;
  const n=ASSUNTOS_FISCAIS[m+'§'+(q.subtema||'').trim()];
  if(n)return 1+FATOR_POR_PROVA_FISCAL*Math.min(n,TETO_PROVAS_FISCAIS);
  if(ASSUNTOS_NEUTROS_EDITAL.has(m+'§'+(q.subtema||'').trim()))return 1;
  // Reforma não é rebaixada: os assuntos da LC 214 são novos demais para já terem
  // histórico de prova, e o bônus de reforma existe justamente para puxá-los.
  return (q.fonte==='tec'&&!ehReformaTributaria(q))?FATOR_FORA_DO_PERFIL:1;
}
function bonusTendencia(q){
  return (ehProvaFiscalRecente(q)?BONUS_PROVA_FISCAL_RECENTE:1)*(ehReformaTributaria(q)?BONUS_REFORMA:1)*fatorAssuntoFiscal(q);
}
const BONUS_FAVORITA_MAX=0.12;
function calcScore(q,statsMap){
  const atrasoNorm=Math.min(Math.max(diasAtraso(q),0),60)/60; // achata em 60 dias; "nunca estudada" (9999) vira teto sozinho
  const k=(q.materia||'—').trim()+'§'+(q.subtema||'—').trim();
  const st=statsMap.get(k)||{taxaErro:0.5,fatiaMateria:1};
  const importancia=pesoDaMateria(q.materia)*st.fatiaMateria;

  // erro ajustado vira MULTIPLICADOR (0,5x a ~1,5x) sobre a importância — nunca
  // uma parcela própria do score, senão erro alto em matéria de peso baixo volta
  // a competir de igual pra igual com matéria de peso alto.
  const erroMod=0.5+st.taxaErro;
  const scoreBase=importancia*erroMod;

  // atraso continua sendo desempate leve — bônus de até +20%, nunca 1/3 do total,
  // pra não deixar peso de edital baixo sobrepor peso alto só por estar mais velho.
  const base=scoreBase*(1+atrasoNorm*0.2)*bonusTendencia(q);

  if(!q.favorita)return base;
  const dominioNorm=Math.min(Math.max(((q.ef??2.5)-1.3)/1.7,0),1);
  return base+BONUS_FAVORITA_MAX*(1-dominioNorm)*importancia; // favorita também escala pelo peso, não é flat
}

// ===== PISO DE COBERTURA POR PESO DO EDITAL =====
// O score de prioridade só decide ORDEM entre o que já está vencido — nunca força
// uma matéria pesada a aparecer se o SM-2 ainda não marcou revisão pra ela (o que
// acontece o tempo todo com matérias de banco pequeno e acerto alto, tipo Auditoria,
// ou de peso baixo mas que zeraram de vez, tipo Análise das Demonstrações Contábeis).
// Isso varre o EDITAL, acha matérias com peso >= LIMIAR_PESO_COBERTURA que não
// aparecem numa resposta há mais de DIAS_SEM_APARECER dias, e força até 1 questão
// dela pra dentro da fila de hoje — furando a fila do SM-2 de propósito, porque
// cobertura de edital não é coisa que o algoritmo de retenção sozinho resolve.
// Zero = toda disciplina do edital é elegível à cobertura forçada. Com 0,08 o corte
// caía em 4,8 pontos (0,08 × 60), e as três disciplinas de 3,33 pontos — Matemática
// Financeira, Raciocínio Lógico e Estatística — ficavam permanentemente de fora da
// rotação. Como o edital exige nota MAIOR QUE ZERO em cada disciplina, deixar uma
// sumir por semanas trabalha contra justamente o que elimina. Custo medido: ~3
// questões por dia em 200
const LIMIAR_PESO_COBERTURA=0; // peso normalizado — pega praticamente tudo, inclusive Análise de Demonstrações (5pts) e o bloco Português/RL/Mat.Financeira/Estatística
const DIAS_SEM_APARECER=5;
async function questoesForcadasPorCobertura(){
  if(!idbOk)return[];
  const desde=Date.now()-DIAS_SEM_APARECER*86400000;
  const log=await lerLog(desde);
  const materiasRecentes=new Set(log.map(r=>(r.materia||'').trim()));
  const pesadas=EDITAL.filter(d=>d.pts/PESO_MAX_EDITAL>=LIMIAR_PESO_COBERTURA).flatMap(d=>d.m);
  const forcar=[];
  const smCob=estatisticasPorAssunto();
  pesadas.forEach(m=>{
    if(materiasRecentes.has(m))return; // já apareceu recentemente, não precisa forçar
    // pega a questão elegível dessa matéria com o intervalo mais LONGO — é a que
    // o SM-2 mais "esqueceu" de mandar de volta, então é a mais urgente pra forçar
    // consolidadas (nunca errou + 2 acertos) não servem para forçar cobertura até a prova
    const candidatas=questions.filter(q=>!q.suspensa&&!materiaPausada(q)&&!consolidadaAteProva(q)&&(q.materia||'').trim()===m);
    if(!candidatas.length)return;
    // Escolhe pelo mesmo critério da fila (peso do assunto × taxa de erro × atraso), preferindo quem já venceu.
    // Antes: maior intervalo = a mais decorada, que o SM-2 tinha adiado de propósito.
    const vencidas=candidatas.filter(isDue);
    forcar.push(vencidas.length?vencidas.reduce((m,q)=>calcScore(q,smCob)>calcScore(m,smCob)?q:m):candidatas.reduce((m,q)=>(q.nextDue||'')<(m.nextDue||'')?q:m));
  });
  return forcar;
}

// ===== PAINEL DE META =====
// VISUALIZAÇÃO APENAS. Não alimenta a fila nem a priorização — o objetivo é
// responder "onde estou", enquanto a engine responde "o que estudar agora".
// Manter separado porque a matemática das duas é diferente de propósito:
// aqui um ponto é um ponto; lá, ponto barato (matéria fraca) vale mais que
// ponto caro (matéria já dominada).
// A projeção usa SÓ questões de banca respondidas dentro do QuestIA. Questão
// gerada por IA não mede dificuldade de banca, então não entra na nota prevista.
function metaCfg(){
  try{return Object.assign({},META_PADRAO,JSON.parse(localStorage.getItem('questia_meta')||'{}'));}
  catch(e){return Object.assign({},META_PADRAO);}
}
function salvarMetaCfg(c){try{localStorage.setItem('questia_meta',JSON.stringify(c));}catch(e){}}
function onMetaInput(){
  const c=metaCfg();
  c.alvo=Math.max(0.3,Math.min(1,(+document.getElementById('meta-alvo').value||80)/100));
  salvarMetaCfg(c);renderMeta();
}

// Suspender por matéria: tira da fila sem apagar nada. É reversível e o histórico
// de cada questão continua onde estava — é o oposto de excluir.
function suspenderMateria(m){
  const alvo=questions.filter(q=>(q.materia||'').trim()===m&&!q.suspensa);
  if(!alvo.length)return;
  if(!confirm(`Suspender ${alvo.length} questões de "${m}"?\n\nElas saem da fila de estudo e da Meta, mas continuam no banco com todo o histórico. Dá para reativar a qualquer momento.`))return;
  alvo.forEach(q=>q.suspensa=true);
  save();updateSidebar();renderMeta();initStudy();
  notify(`⏸ ${alvo.length} questões de "${m}" suspensas — fora da fila, intactas no banco`,'ok');
}
function reativarMateria(m){
  const alvo=questions.filter(q=>(q.materia||'').trim()===m&&q.suspensa);
  if(!alvo.length)return;
  alvo.forEach(q=>q.suspensa=false);
  save();updateSidebar();renderMeta();initStudy();
  notify(`▶ ${alvo.length} questões de "${m}" reativadas`,'ok');
}
// Suspender por subtema: mesmo espírito de suspenderMateria, mas granular o
// bastante pra tirar da fila só um recorte específico (ex.: TI - Banco de
// Dados > PostgreSQL) sem mexer no resto da matéria. Usa os filtros já
// selecionados no Banco (matéria + subtema) pra saber o que suspender.
function suspenderSubtemaAtual(){
  const fm=document.getElementById('f-materia').value;
  const fsub=document.getElementById('f-subtema').value;
  if(!fsub){notify('Selecione um subtema no filtro para suspender em massa','err');return;}
  const alvo=questions.filter(q=>(q.subtema||'').trim()===fsub&&(!fm||(q.materia||'').trim()===fm)&&!q.suspensa);
  const rotulo=fm?`${fm} · ${fsub}`:fsub;
  if(!alvo.length){notify(`Nenhuma questão ativa em "${rotulo}" para suspender`,'ok');return;}
  if(!confirm(`Suspender ${alvo.length} questões de "${rotulo}"?\n\nElas saem da fila de estudo e da Meta, mas continuam no banco com todo o histórico. Dá para reativar a qualquer momento.`))return;
  alvo.forEach(q=>q.suspensa=true);
  save();updateSidebar();renderBanco();renderMeta();initStudy();
  notify(`⏸ ${alvo.length} questões de "${rotulo}" suspensas — fora da fila, intactas no banco`,'ok');
}
function reativarSubtemaAtual(){
  const fm=document.getElementById('f-materia').value;
  const fsub=document.getElementById('f-subtema').value;
  if(!fsub){notify('Selecione um subtema no filtro para reativar em massa','err');return;}
  const alvo=questions.filter(q=>(q.subtema||'').trim()===fsub&&(!fm||(q.materia||'').trim()===fm)&&q.suspensa);
  const rotulo=fm?`${fm} · ${fsub}`:fsub;
  if(!alvo.length){notify(`Nenhuma questão suspensa em "${rotulo}"`,'ok');return;}
  alvo.forEach(q=>q.suspensa=false);
  save();updateSidebar();renderBanco();renderMeta();initStudy();
  notify(`▶ ${alvo.length} questões de "${rotulo}" reativadas`,'ok');
}
// Limpeza retroativa: a partir de agora, toda questão nova nasce suspensa se a
// matéria não bater com o EDITAL (ver mkQ/confirmarImportTec), mas isso não
// alcança as que já estavam no banco antes dessa mudança. Este botão aplica a
// mesma regra de uma vez em tudo que já existe.
function suspenderTodasForaDoEdital(){
  const alvo=questions.filter(q=>!q.suspensa&&materiaForaDoEdital(q.materia));
  if(!alvo.length){notify('Nada fora do edital para suspender','ok');return;}
  const mats=[...new Set(alvo.map(q=>(q.materia||'').trim()))];
  if(!confirm(`Suspender ${alvo.length} questões de ${mats.length} matérias fora do edital?\n\n${mats.join(', ')}\n\nSaem da fila e da Meta, mas continuam no banco com todo o histórico. Dá para reativar a qualquer momento.`))return;
  alvo.forEach(q=>q.suspensa=true);
  save();updateSidebar();renderMeta();initStudy();
  notify(`⏸ ${alvo.length} questões suspensas de uma vez`,'ok');
}
function dadosMeta(){
  const porMat=new Map();
  questions.forEach(q=>{
    if(q.suspensa)return;                                  // suspensa = fora do perfil: não entra na Meta
    if((q.fonte||'ia')!=='tec')return;                 // só banca
    const m=(q.materia||'').trim();
    const o=porMat.get(m)||{ac:0,er:0,qtd:0};
    o.ac+=q.acertos||0;o.er+=q.erros||0;o.qtd++;
    porMat.set(m,o);
  });
  // Mesma contagem, mas do que FICOU DE FORA por não ser de banca. Serve só para
  // explicar um "sem dado": disciplina com 24 respostas que não aparecem na projeção
  // é indistinguível de disciplina que você nunca estudou, e as duas pedem atitudes
  // opostas. Não entra em conta nenhuma.
  const porMatIA=new Map();
  questions.forEach(q=>{
    if((q.fonte||'ia')==='tec')return;
    const m=(q.materia||'').trim();
    const o=porMatIA.get(m)||{resp:0,qtd:0};
    o.resp+=(q.acertos||0)+(q.erros||0);o.qtd++;
    porMatIA.set(m,o);
  });
  const usadas=new Set();
  const linhas=EDITAL.map(d=>{
    let ac=0,er=0,qtd=0,foraQtd=0,foraResp=0;
    d.m.forEach(m=>{
      const o=porMat.get(m);if(o){ac+=o.ac;er+=o.er;qtd+=o.qtd;usadas.add(m);}
      const oi=porMatIA.get(m);if(oi){foraQtd+=oi.qtd;foraResp+=oi.resp;}
    });
    const resp=ac+er;
    return{...d, qtd, resp, ac, foraQtd, foraResp,
      taxa: resp>0?ac/resp:null,
      taxaSeed: d.sR>0?d.sA/d.sR:null};
  });
  const orfas=[...porMat.entries()].filter(([m])=>!usadas.has(m)).map(([m,o])=>({m,qtd:o.qtd}));
  // O aviso de "matéria fora do edital" reusava o porMat acima — que só conta banca
  // (`fonte==='tec'`) de propósito, porque a previsão de nota não deve misturar
  // questão gerada por IA com estatística de prova real. Só que isso também deixava
  // o próprio AVISO cego pra questão de IA: uma "Economia e Finanças Públicas"
  // gerada com matéria que não bate com nada do EDITAL nunca aparecia aqui. Esse
  // mapa é só para o aviso — conta todo mundo, TEC ou IA.
  const porMatTodas=new Map();
  questions.forEach(q=>{
    const m=(q.materia||'').trim();
    if(m)porMatTodas.set(m,(porMatTodas.get(m)||0)+1);
  });
  const matsEdital=new Set(EDITAL.flatMap(d=>d.m));
  const orfasIA=[...porMatTodas.entries()].filter(([m])=>!matsEdital.has(m)&&!orfas.some(o=>o.m===m)).map(([m,qtd])=>({m,qtd}));
  return{linhas,orfas:[...orfas,...orfasIA]};
}

function renderMeta(){
  const wrap=document.getElementById('meta-body');if(!wrap)return;
  const cfg=metaCfg(), {linhas,orfas}=dadosMeta();
  const el=document.getElementById('meta-alvo');
  if(el&&document.activeElement!==el)el.value=Math.round(cfg.alvo*100);
  const totalPts=linhas.reduce((a,d)=>a+d.pts,0);
  const comDado=linhas.filter(d=>d.taxa!==null);
  const ptsCobertos=comDado.reduce((a,d)=>a+d.pts,0);
  const cobertura=ptsCobertos/totalPts;
  const ptsProj=comDado.reduce((a,d)=>a+d.pts*d.taxa,0);
  const notaProj=ptsCobertos>0?ptsProj/ptsCobertos:null;
  const respTotal=linhas.reduce((a,d)=>a+d.resp,0);

  // por prova
  const provas=['I','II'].map(P=>{
    const ls=linhas.filter(d=>d.p===P), cd=ls.filter(d=>d.taxa!==null);
    const pts=ls.reduce((a,d)=>a+d.pts,0), ptsC=cd.reduce((a,d)=>a+d.pts,0);
    const proj=cd.reduce((a,d)=>a+d.pts*d.taxa,0);
    return{P,pts,ptsC,cob:ptsC/pts,taxa:ptsC>0?proj/ptsC:null,qtd:P==='I'?90:70};
  });

  const cor=t=>t===null?'var(--muted)':t>=cfg.alvo?'var(--green)':t>=cfg.pisoProva?'var(--yellow)':'var(--accent)';
  const pct=t=>t===null?'—':Math.round(t*100)+'%';

  // Quantas respostas suas NÃO entram aqui por serem de questões geradas por IA.
  // Antes isso era silencioso: você respondia 200 questões e a Meta não mexia um dígito,
  // sem nada na tela explicando por quê. A regra continua a mesma — questão de IA não
  // mede dificuldade de banca —, mas agora ela é dita, não adivinhada.
  const respIA=questions.reduce((a,q)=>a+((q.fonte||'ia')!=='tec'?(q.acertos||0)+(q.erros||0):0),0);
  let html='';
  if(respIA>0){
    html+=`<div style="margin-bottom:18px;padding:11px 13px;border-radius:10px;background:var(--surface);border:1px solid var(--border);font-size:12px;color:var(--ink2);line-height:1.6">
      <strong>${respTotal}</strong> respostas de banca alimentam esta projeção.
      Outras <strong>${respIA}</strong> respostas suas são de questões geradas por IA e <strong>não entram</strong> —
      questão que eu escrevi não mede dificuldade de banca, e contá-la aqui inflaria a previsão.
      Se a Meta parece parada mesmo você estudando, é quase sempre isto: a fila está te dando questões de IA.
      Ajuste a fatia do dia reservada a questões novas de banca em <strong>Ajustes → % do dia para questões novas de banca</strong>.
    </div>`;
  }
  if(respTotal===0){
    html+=`<div class="import-warning" style="margin-bottom:24px">
      <strong>Ainda sem base para projetar.</strong> A nota prevista usa só questões de banca respondidas aqui dentro,
      e você tem <strong>${linhas.reduce((a,d)=>a+d.qtd,0)}</strong> importadas com <strong>0</strong> respondidas.
      Importe cadernos do TecConcursos e comece a responder — o painel se preenche sozinho.
      Enquanto isso, a coluna cinza mostra seu histórico de 6 meses atrás como referência.
    </div>`;
  }

  // ---- topo ----
  html+=`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:1px;background:var(--border);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;margin-bottom:8px">
    <div class="tile-meta" style="background:var(--surface);padding:22px 24px">
      <div style="font-family:'Instrument Serif',serif;font-size:44px;line-height:1;color:${cor(notaProj)}">${pct(notaProj)}</div>
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;font-weight:600;margin-top:6px">Nota prevista</div>
      <div style="font-size:12px;color:var(--muted);margin-top:4px">${notaProj===null?'sem dado ainda':'sobre os pontos já medidos'}</div>
    </div>
    <div style="background:var(--surface);padding:22px 24px">
      <div style="font-family:'Instrument Serif',serif;font-size:44px;line-height:1">${Math.round(cfg.alvo*100)}%</div>
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;font-weight:600;margin-top:6px">Sua meta</div>
      <div style="font-size:12px;color:var(--muted);margin-top:4px">${Math.round(cfg.alvo*totalPts)} dos ${Math.round(totalPts)} pontos</div>
    </div>
    <div style="background:var(--surface);padding:22px 24px">
      <div style="font-family:'Instrument Serif',serif;font-size:44px;line-height:1;color:${cobertura<0.5?'var(--accent)':cobertura<0.85?'var(--yellow)':'var(--green)'}">${Math.round(cobertura*100)}%</div>
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;font-weight:600;margin-top:6px">Cobertura da previsão</div>
      <div style="font-size:12px;color:var(--muted);margin-top:4px">${Math.round(ptsCobertos)} de ${Math.round(totalPts)} pontos têm medição</div>
    </div>
    <div style="background:var(--surface);padding:22px 24px">
      <div style="font-family:'Instrument Serif',serif;font-size:44px;line-height:1">${respTotal}</div>
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;font-weight:600;margin-top:6px">Respostas de banca</div>
      <div style="font-size:12px;color:var(--muted);margin-top:4px">base da previsão</div>
    </div>
  </div>
  <div style="font-size:12px;color:var(--muted);margin-bottom:26px;line-height:1.6">
    A nota prevista é calculada só sobre os pontos que têm medição. Com <strong>${Math.round(cobertura*100)}%</strong> de cobertura,
    ela ${cobertura<0.5?'<strong style="color:var(--accent)">ainda não representa a prova</strong>':'já dá uma leitura razoável'} — o número sobe em confiança conforme você responde mais disciplinas.
  </div>`;

  // ---- eliminação por prova ----
  html+=`<div class="chart-title" style="margin-bottom:6px">⚖️ Piso de eliminação por prova</div>
   <div style="font-size:12px;color:var(--muted);margin-bottom:16px;line-height:1.6">
     O edital exige <strong>no mínimo 60% dos pontos ponderados em CADA prova</strong> e nota maior que zero em cada disciplina.
     Não há compensação entre as duas: ficar abaixo do piso numa delas elimina, mesmo com nota alta na outra.
   </div>
   <div style="display:grid;grid-template-columns:1fr;gap:14px;margin-bottom:30px">`;
  provas.forEach(p=>{
    const c=cor(p.taxa);
    const larg=p.taxa===null?0:Math.min(100,p.taxa*100);
    html+=`<div class="card" style="padding:18px 20px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:12px">
        <div><strong style="font-size:15px">Prova ${p.P}</strong>
          <span style="font-size:12px;color:var(--muted)"> · ${p.qtd} questões · ${Math.round(p.pts)} pontos (${Math.round(p.pts/totalPts*100)}% do total)</span></div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:17px;font-weight:700;color:${c}">${pct(p.taxa)}
          <span style="font-size:11px;color:var(--muted);font-weight:400">${p.taxa!==null&&p.taxa<cfg.pisoProva?' · ABAIXO DO PISO':''}</span></div>
      </div>
      <div style="position:relative;height:18px;background:var(--surface2);border-radius:4px;overflow:hidden">
        <div style="height:100%;width:${larg}%;background:${c};border-radius:4px 0 0 4px;transition:width .5s"></div>
        <div style="position:absolute;left:${cfg.pisoProva*100}%;top:-3px;bottom:-3px;width:2px;background:var(--ink);opacity:.65"></div>
        <div style="position:absolute;left:${cfg.alvo*100}%;top:-3px;bottom:-3px;width:2px;background:var(--accent2);opacity:.65"></div>
      </div>
      <div style="display:flex;gap:18px;font-size:11px;color:var(--muted);margin-top:7px">
        <span>▏ piso ${Math.round(cfg.pisoProva*100)}% (eliminatório)</span>
        <span style="color:var(--accent2)">▏ sua meta ${Math.round(cfg.alvo*100)}%</span>
        <span style="margin-left:auto">cobertura ${Math.round(p.cob*100)}%</span>
      </div>
    </div>`;
  });
  html+=`</div>`;

  // ---- disciplinas ----
  html+=`<div class="chart-title" style="margin-bottom:6px">📋 Disciplina por disciplina</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:16px">Ordenado por peso na prova. A barra cinza é o histórico do TecConcursos (6 meses atrás), mostrado só como referência — não entra na previsão.</div>`;
  ['II','I'].forEach(P=>{
    html+=`<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin:18px 0 10px">Prova ${P}</div>`;
    linhas.filter(d=>d.p===P).sort((a,b)=>b.pts-a.pts).forEach(d=>{
      const c=cor(d.taxa);
      html+=`<div style="padding:11px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:6px">
          <div style="flex:1;min-width:210px">
            <span style="font-weight:600;font-size:14px">${esc(d.n)}</span>
            <span style="font-size:11px;color:var(--muted)"> · ${Math.round(d.pts)} pts · ${Math.round(d.pts/totalPts*1000)/10}%</span>
          </div>
          <div style="display:flex;align-items:center;gap:14px">
            <span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--muted)" title="${d.resp?'':(d.foraResp?d.foraResp+' respostas nesta disciplina não entram: são de questões marcadas como geradas por IA, e a projeção usa só questões de banca.':(d.foraQtd?d.foraQtd+' questões desta disciplina estão no banco como geradas por IA.':'Nenhuma questão de banca desta disciplina foi respondida aqui ainda.'))}">${d.resp?d.resp+' resp.':(d.foraResp?'sem dado · '+d.foraResp+' fora':'sem dado')}</span>
            <span style="font-family:'JetBrains Mono',monospace;font-size:15px;font-weight:700;color:${c};min-width:48px;text-align:right">${pct(d.taxa)}</span>
          </div>
        </div>
        <div style="display:flex;gap:4px;align-items:center">
          <div style="flex:1;height:8px;background:var(--surface2);border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${d.taxa===null?0:d.taxa*100}%;background:${c};border-radius:3px"></div>
          </div>
        </div>
        ${d.taxaSeed!==null?`<div style="display:flex;gap:4px;align-items:center;margin-top:3px">
          <div style="flex:1;height:4px;background:var(--surface2);border-radius:2px;overflow:hidden">
            <div style="height:100%;width:${d.taxaSeed*100}%;background:var(--border2);border-radius:2px"></div>
          </div>
          <span style="font-size:10px;color:var(--muted);font-family:'JetBrains Mono',monospace;min-width:86px;text-align:right">TEC ${Math.round(d.taxaSeed*100)}% · ${d.sR}</span>
        </div>`:''}
      </div>`;
    });
  });

  if(orfas.length){
    // Matéria órfã é sempre uma de duas coisas: material de OUTRO concurso, que só
    // disputa seu tempo; ou disciplina sua que eu não soube mapear. As duas pedem
    // ações opostas, então cada uma ganha seu botão em vez de um aviso genérico.
    const totalOrf=orfas.reduce((a,o)=>a+o.qtd,0);
    const ativas=m=>questions.filter(q=>(q.materia||'').trim()===m&&!q.suspensa).length;
    html+=`<div class="import-warning" style="margin-top:24px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <strong>${orfas.length} matérias fora do edital do ISS Manaus — ${totalOrf} questões.</strong>
        <button class="btn btn-outline btn-sm" onclick="suspenderTodasForaDoEdital()">⏸ Suspender todas de uma vez</button>
      </div>
      Elas não entram na nota prevista (não sei a que disciplina correspondem) mas <em>continuam disputando seu tempo na fila de estudo</em>.
      Se forem de outro concurso, suspenda: sai da fila e da Meta, o histórico fica intacto e você reativa quando quiser.
      <div style="margin-top:12px;display:flex;flex-direction:column;gap:6px">
        ${orfas.map(o=>{const at=ativas(o.m);return `<div style="display:flex;align-items:center;gap:10px;justify-content:space-between;flex-wrap:wrap;padding:6px 0;border-top:1px solid rgba(217,119,6,.2)">
          <span style="font-size:12px;color:var(--ink2)">${esc(o.m)} — <strong>${o.qtd}</strong> questões${at<o.qtd?` <span style="color:var(--muted)">(${o.qtd-at} já suspensas)</span>`:''}</span>
          ${at?`<button class="btn btn-outline btn-sm" onclick="suspenderMateria(${JSON.stringify(o.m).replace(/"/g,'&quot;')})">⏸ Suspender ${at}</button>`
              :`<button class="btn btn-ghost btn-sm" onclick="reativarMateria(${JSON.stringify(o.m).replace(/"/g,'&quot;')})">▶ Reativar</button>`}
        </div>`;}).join('')}
      </div>
    </div>`;
  }
  wrap.innerHTML=html;
}

// ===== MODO RETA FINAL =====
// O SM-2 é feito para retenção de longo prazo: a cada acerto o intervalo estica.
// Isso é certo quando a prova é longe e errado quando ela é perto — uma questão
// acertada 3 vezes vai para 36 dias, e na 4ª para 108. Perto da prova, esse
// agendamento simplesmente remove a questão da preparação.
// Com data de prova cadastrada, o teto do intervalo passa a ser uma FRAÇÃO do que
// falta (nunca agenda para depois da prova) e o espaçamento volta ao Anki puro.
// Tudo isso se desliga sozinho depois da data.
const TETO_MIN_RETA=2;
// Escopo do teto da reta final. O padrão é 'tec' porque as questões geradas por IA
// que já estão muito espaçadas representam assunto DOMINADO: puxá-las de volta a
// cada 20 dias gasta slot com o que você já sabe, competindo com questão de banca
// inédita. O teto existe para garantir passada nas novas, não para reciclar as velhas.
function retaCfg(){
  const c=schedCfgBruto();
  return{escopo:c.retaEscopo||'tec', fracao:(c.retaFracao>0&&c.retaFracao<=1)?c.retaFracao:0.4};
}
function retaAlcanca(fonte){
  const e=retaCfg().escopo;
  if(e==='nenhuma')return false;
  if(e==='todas')return true;
  return (fonte||'ia')==='tec';
}

function dataProva(){
  try{const d=(schedCfgBruto().provaEm||'').trim();return /^\d{4}-\d{2}-\d{2}$/.test(d)?d:'';}catch(e){return '';}
}
function diasAteProva(){
  const d=dataProva();if(!d)return null;
  const dif=Math.round((new Date(d+'T00:00:00')-new Date(today()+'T00:00:00'))/86400000);
  return dif;
}
function modoReta(){const n=diasAteProva();return n!==null&&n>0;}

// schedCfgBruto = o que você configurou. schedCfg = o que o algoritmo usa hoje,
// já com o modo reta final aplicado por cima. Manter os dois separados evita
// sobrescrever a sua configuração original quando a prova passar.
// Object.assign SUBSTITUI o array inteiro, não completa posição a posição. Como a
// configuração fica salva no navegador, uma config gravada por uma versão antiga
// (deltaEase e entrada com 4 posições) apagava a 5ª posição adicionada depois — e
// cfg.entrada[4] indefinido virava NaN em cascata: intervalo NaN, facilidade NaN,
// nextDue "NaN-NaN-NaN", ou seja, questão fora do agendamento para sempre.
// Por isso todo array de configuração é completado pelo padrão depois do merge.
function completarArrays(c){
  Object.keys(SCHED_PADRAO).forEach(k=>{
    const padrao=SCHED_PADRAO[k];
    if(!Array.isArray(padrao))return;
    if(!Array.isArray(c[k])){c[k]=padrao.slice();return;}
    for(let i=0;i<padrao.length;i++){
      if(c[k][i]===undefined||c[k][i]===null&&padrao[i]!==null)c[k][i]=padrao[i];
    }
    if(c[k].length<padrao.length)c[k]=c[k].concat(padrao.slice(c[k].length));
  });
  return c;
}
function schedCfgBruto(){
  try{return completarArrays(Object.assign({provaEm:''},SCHED_PADRAO,JSON.parse(localStorage.getItem('questia_sched')||'{}')));}
  catch(e){return Object.assign({provaEm:''},SCHED_PADRAO);}
}
function tetoRetaFinal(dias){const f=retaCfg().fracao;return Math.max(TETO_MIN_RETA,Math.min(dias,Math.round(dias*f)));}

function onRetaInput(){
  const c=schedCfgBruto();
  c.retaEscopo=document.getElementById('reta-escopo').value;
  c.retaFracao=Math.max(0.2,Math.min(1,(+document.getElementById('reta-frac').value||40)/100));
  salvarSchedCfg(c);
  renderRetaFinal();renderSchedPreview();
}
function renderRetaFinal(){
  const el=document.getElementById('reta-info');if(!el)return;
  const c=schedCfgBruto(),n=diasAteProva(),rc=retaCfg();
  const inp=document.getElementById('sched-prova');
  if(inp&&document.activeElement!==inp)inp.value=c.provaEm||'';
  const se=document.getElementById('reta-escopo');if(se)se.value=rc.escopo;
  const sf=document.getElementById('reta-frac');
  if(sf&&document.activeElement!==sf)sf.value=Math.round(rc.fracao*100);
  const sv=document.getElementById('reta-frac-val');if(sv)sv.textContent=Math.round(rc.fracao*100)+'%';
  if(n===null){
    el.innerHTML='<div style="font-size:13px;color:var(--muted)">Sem data de prova: o agendamento usa exatamente os valores acima.</div>';
    return;
  }
  if(n<=0){
    el.innerHTML='<div class="import-warning" style="margin:0">A data da prova já passou. O modo reta final está desligado e seus valores originais voltaram a valer. Apague a data ou cadastre a próxima.</div>';
    return;
  }
  const teto=tetoRetaFinal(n),ef=schedCfg();
  const foraDoAlcance=questions.filter(q=>{
    if(q.suspensa||!q.nextDue||!retaAlcanca(q.fonte))return false;
    return Math.round((new Date(q.nextDue+'T00:00:00')-new Date(today()+'T00:00:00'))/86400000)>n;
  }).length;
  el.innerHTML=`
    <div style="display:flex;gap:20px;flex-wrap:wrap;align-items:center;margin-bottom:14px">
      <div style="background:var(--accent-light);border:1px solid rgba(192,57,43,.25);border-radius:8px;padding:10px 18px;text-align:center">
        <div style="font-family:'Instrument Serif',serif;font-size:30px;line-height:1;color:var(--accent)">${n}</div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--accent);font-weight:600">dias até a prova</div>
      </div>
      <div style="font-size:13px;color:var(--ink2);line-height:1.7;flex:1;min-width:260px">
        ${rc.escopo==='nenhuma'
          ? `Teto <strong>desligado</strong>. O agendamento segue exatamente os valores acima, mesmo com a prova marcada.`
          : `Teto de <strong>${teto} dia${teto>1?'s':''}</strong> (${Math.round(rc.fracao*100)}% do que falta, em vez de ${c.tetoDias}) e espaçamento em <strong>100%</strong>,
             valendo para <strong>${rc.escopo==='todas'?'todas as questões':'as questões de banca importadas'}</strong>.
             ${rc.escopo==='tec'?`As ${questions.filter(q=>(q.fonte||'ia')!=='tec').length} geradas por IA seguem no seu agendamento normal — assunto já dominado não é puxado de volta.`:''}
             O teto encolhe sozinho conforme a data se aproxima.`}
      </div>
    </div>
    ${foraDoAlcance?`<div class="import-warning" style="margin:0">⚠️ <strong>${foraDoAlcance} questões</strong> já estão agendadas para depois da prova — foram espaçadas antes de você cadastrar a data. Elas voltam à fila conforme forem vencendo, ou use o botão abaixo para trazê-las de volta agora.
      <div style="margin-top:10px"><button class="btn btn-outline btn-sm" onclick="puxarParaDentroDaProva()">Trazer as ${foraDoAlcance} para dentro do prazo</button></div></div>`:
      '<div style="font-size:13px;color:var(--green)">✓ Nenhuma questão agendada para depois da prova.</div>'}`;
}

// Reagenda o que ficou fora do alcance, espalhando pelos dias restantes em vez de
// jogar tudo para hoje — 900 questões vencendo de uma vez não é revisão, é pânico.
function puxarParaDentroDaProva(){
  const n=diasAteProva();if(n===null||n<=0)return;
  const fora=questions.filter(q=>!q.suspensa&&q.nextDue&&retaAlcanca(q.fonte)&&
    Math.round((new Date(q.nextDue+'T00:00:00')-new Date(today()+'T00:00:00'))/86400000)>n);
  if(!fora.length)return;
  const teto=tetoRetaFinal(n);
  if(!confirm(`Reagendar ${fora.length} questões para caberem antes da prova?\n\nElas serão distribuídas ao longo dos próximos ${teto} dias, do intervalo mais longo para o mais curto.\nNada é apagado e a facilidade de cada questão não muda.`))return;
  fora.sort((a,b)=>(b.interval||0)-(a.interval||0));
  fora.forEach((q,i)=>{
    const d=new Date();d.setDate(d.getDate()+(i%teto));
    q.nextDue=ymd(d); q.interval=Math.min(q.interval||teto,teto);
  });
  save();updateSidebar();renderRetaFinal();initStudy();
  notify(`✓ ${fora.length} questões reagendadas para os próximos ${teto} dias`,'ok');
}
function onProvaInput(){
  const c=schedCfgBruto();
  c.provaEm=(document.getElementById('sched-prova').value||'').trim();
  salvarSchedCfg(c);
  renderRetaFinal();renderSchedPreview();
  const n=diasAteProva();
  if(n!==null&&n>0)notify(`Modo reta final ativo — ${n} dias até a prova`,'ok');
  else if(!c.provaEm)notify('Data removida — agendamento normal','ok');
}

function renderSchedCard(){
  const c=schedCfgBruto();
  const im=document.getElementById('sched-im');if(!im)return;
  im.value=Math.round(c.im*100);
  document.getElementById('sched-teto').value=c.tetoDias;
  document.getElementById('sched-limite').value=c.limiteDiario;
  document.getElementById('sched-cota').value=Math.round((c.cotaNovas??0.40)*100);
  document.getElementById('sched-leech').value=c.leechLimite;
  document.getElementById('im-val').textContent=Math.round(c.im*100)+'%';
  document.getElementById('sched-presets').innerHTML=SCHED_PRESETS.map(p=>
    `<button class="chip ${Math.abs(c.im-p.im)<0.001?'active':''}" style="padding:8px 14px;font-size:11px" onclick="aplicarPreset(${p.im})">${p.nome} · ${p.desc}</button>`).join('');
  renderRetaFinal();
  renderSchedPreview();
}
function renderSchedPreview(){
  const linhas=[0,4,10,30,90];
  const th='padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);border-bottom:1px solid var(--border)';
  const td='padding:8px 10px;border-bottom:1px solid var(--border);font-family:\'JetBrains Mono\',monospace';
  let html=`<tr><th style="${th}">Intervalo atual</th><th style="${th};color:var(--accent)">✗ Errei</th><th style="${th};color:var(--yellow)">↩ Difícil</th><th style="${th};color:var(--accent2)">✓ Bom</th><th style="${th};color:var(--green)">⚡ Fácil</th><th style="${th};color:var(--susp-ink)">🎯 Dominada</th></tr>`;
  linhas.forEach(iv=>{
    const reps=iv===0?0:3;
    const cel=q=>{const d=sm2(q,reps,2.5,iv,true,retaCfg().escopo==='todas'?'ia':'tec').intervalBase;return d===1?'1 dia':d+' dias';};
    html+=`<tr><td style="${td};color:var(--muted)">${iv===0?'questão nova':iv+' dias'}</td><td style="${td}">${cel(0)}</td><td style="${td}">${cel(1)}</td><td style="${td}">${cel(2)}</td><td style="${td}">${cel(3)}</td><td style="${td}">${cel(4)}</td></tr>`;
  });
  document.getElementById('sched-preview').innerHTML=html;
  const av=document.getElementById('sched-aviso');
  if(av){
    const c=schedCfg(retaCfg().escopo==='todas'?'ia':'tec'),b=schedCfgBruto();
    av.innerHTML=(c.tetoDias<b.tetoDias||c.im<b.im)
      ? `<span style="color:var(--accent2)">Os números acima valem para as questões ${retaCfg().escopo==='todas'?'':'<strong>de banca</strong> '}sob o modo reta final (teto ${c.tetoDias} dias, espaçamento ${Math.round(c.im*100)}%).${retaCfg().escopo==='tec'?' As geradas por IA seguem com '+b.tetoDias+' dias e '+Math.round(b.im*100)+'%.':''}</span>`
      : '';
  }
}
function onSchedInput(){
  const c=schedCfgBruto();
  c.im=Math.max(0.5,Math.min(3,(+document.getElementById('sched-im').value||100)/100));
  c.tetoDias=Math.max(7,Math.min(3650,+document.getElementById('sched-teto').value||365));
  c.limiteDiario=Math.max(0,Math.min(999,+document.getElementById('sched-limite').value||0));
  c.cotaNovas=Math.max(0,Math.min(1,(+document.getElementById('sched-cota').value||0)/100));
  c.leechLimite=Math.max(2,Math.min(30,+document.getElementById('sched-leech').value||5));
  salvarSchedCfg(c);
  document.getElementById('im-val').textContent=Math.round(c.im*100)+'%';
  document.getElementById('sched-presets').innerHTML=SCHED_PRESETS.map(p=>
    `<button class="chip ${Math.abs(c.im-p.im)<0.001?'active':''}" style="padding:8px 14px;font-size:11px" onclick="aplicarPreset(${p.im})">${p.nome} · ${p.desc}</button>`).join('');
  renderSchedPreview();
}
function aplicarPreset(im){const c=schedCfgBruto();c.im=im;salvarSchedCfg(c);renderSchedCard();notify('Espaçamento em '+Math.round(im*100)+'% — vale para as próximas respostas','ok');}
function resetSched(){localStorage.removeItem('questia_sched');renderSchedCard();notify('Agendamento restaurado ao padrão','ok');}

// ===== ACERTO POR SUBTEMA =====
// A pergunta que o app não sabia responder: "em QUE eu erro?". Ele dizia quantas
// você errou, nunca em qual conceito. Só funciona com subtema canônico — com uma
// string única por questão, cada linha teria n=1 e a lista não significaria nada.
function statsPorSubtema(){
  const por=new Map();
  questions.forEach(q=>{
    const s=(q.subtema||'').trim();if(!s)return;
    const k=(q.materia||'—').trim()+'§'+s;
    if(!por.has(k))por.set(k,{materia:(q.materia||'—').trim(),subtema:s,ac:0,er:0,tot:0,pend:0});
    const o=por.get(k);
    o.ac+=q.acertos||0;o.er+=q.erros||0;o.tot++;
    if(isDue(q)&&!q.suspensa)o.pend++;
  });
  return [...por.values()].map(o=>({...o,resp:o.ac+o.er,pct:(o.ac+o.er)>0?o.ac/(o.ac+o.er)*100:null}));
}
function renderSubtemas(){
  const el=document.getElementById('sub-chart');if(!el)return;
  const min=parseInt((document.getElementById('sub-min')||{value:3}).value,10)||1;
  const todos=statsPorSubtema();
  const comDado=todos.filter(o=>o.resp>=min&&o.pct!==null).sort((a,b)=>a.pct-b.pct);
  const semDado=todos.filter(o=>o.resp===0).length;
  if(!todos.length){
    el.innerHTML='<div style="color:var(--muted);font-size:13px">Nenhuma questão tem subtema ainda. Aplique a taxonomia em <strong>Backup → Aplicar taxonomia</strong>.</div>';return;
  }
  if(!comDado.length){
    el.innerHTML=`<div style="color:var(--muted);font-size:13px">Nenhum subtema chegou a ${min} resposta${min>1?'s':''}. Reduza o mínimo ou responda mais questões.</div>`;return;
  }
  const lista=comDado.slice(0,15);
  el.innerHTML=lista.map(o=>{
    const cor=o.pct<50?'var(--accent)':o.pct<75?'var(--yellow)':'var(--green)';
    const arg=esc(o.subtema).replace(/'/g,'&#39;'), argM=esc(o.materia).replace(/'/g,'&#39;');
    return `<div style="padding:12px 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:7px">
        <div style="flex:1;min-width:200px">
          <div style="font-weight:600;font-size:14px;line-height:1.35">${esc(o.subtema)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">${esc(o.materia)} · ${o.tot} questão${o.tot>1?'ões':''} · ${o.resp} resposta${o.resp>1?'s':''}${o.pend?` · ${o.pend} para revisar`:''}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-family:'JetBrains Mono',monospace;font-size:15px;font-weight:700;color:${cor};font-variant-numeric:tabular-nums">${Math.round(o.pct)}%</span>
          <button class="btn btn-outline btn-sm" onclick="estudarSubtema('${argM}','${arg}')">Estudar</button>
          <button class="btn btn-ghost btn-sm" onclick="filtrarPorSubtema('${arg}')">Ver</button>
        </div>
      </div>
      <div class="prog-bar"><div class="prog-fill" style="width:${Math.max(o.pct,2)}%;background:${cor}"></div></div>
    </div>`;
  }).join('')
  + `<div style="margin-top:14px;font-size:12px;color:var(--muted)">
       ${comDado.length>15?`Mostrando os 15 piores de ${comDado.length} subtemas com pelo menos ${min} resposta${min>1?'s':''}. `:''}
       ${semDado?`<strong>${semDado}</strong> subtema${semDado>1?'s':''} ainda sem nenhuma resposta — não entram no ranking, mas são justamente onde você não tem ideia de como vai.`:''}
     </div>`;
}
function estudarSubtema(materia,subtema){
  nav('estudar');
  const fm=document.getElementById('f-estudar-materia');
  fm.value=materia; if(fm.value!==materia)fm.value='';
  populateEstudarSubtemas();
  const fs=document.getElementById('f-estudar-subtema');
  fs.value=subtema;
  if(fs.value!==subtema){notify('Subtema não encontrado','err');return;}
  ignorarLimite=true; // sessão dirigida a um conceito não deve morrer na meta do dia
  initStudy();
  notify(`Sessão de "${subtema}"`,'ok');
}

// ===== DIAGNÓSTICO DE MISTURA =====
// Responde, com o log real de respostas, a pergunta "o site fica me dando blocos da
// mesma matéria?". Três medidas, porque uma só engana: a distribuição diz QUANTO de
// cada matéria; a média por janela diz se elas vêm alternadas ou empilhadas; e a
// maior sequência seguida pega o caso extremo que a média esconde.
const MISTURA_N=500;
async function renderMistura(){
  const el=document.getElementById('mistura-corpo');if(!el)return;
  el.textContent='Lendo o histórico…';
  const L=(await lerLog()).slice(-MISTURA_N);
  if(!L.length){el.innerHTML='<span style="color:var(--muted)">Sem respostas registradas ainda.</span>';return;}
  const seq=L.map(x=>(x.materia||'—').trim());
  const cont={};seq.forEach(m=>cont[m]=(cont[m]||0)+1);
  const janela=n=>{const v=[];for(let i=0;i+n<=seq.length;i+=n)v.push(new Set(seq.slice(i,i+n)).size);
    return v.length?+(v.reduce((a,b)=>a+b,0)/v.length).toFixed(1):0;};
  let run=1,maxRun=1,matRun=seq[0];
  for(let i=1;i<seq.length;i++){if(seq[i]===seq[i-1]){run++;if(run>maxRun){maxRun=run;matRun=seq[i];}}else run=1;}
  const ord=Object.entries(cont).sort((a,b)=>b[1]-a[1]);
  const mx=ord[0][1];
  const diag=(v)=>v>=4?['bem misturado','var(--green)']:v>=2.5?['razoável','var(--yellow)']:['em blocos','var(--accent)'];
  const [rot,cor]=diag(janela(10));
  el.innerHTML=`
    <div style="display:flex;gap:26px;flex-wrap:wrap;margin-bottom:16px">
      <div><div style="font-size:26px;font-family:'Instrument Serif',serif;color:${cor}">${janela(10)}</div>
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">matérias por 10 respostas · ${rot}</div></div>
      <div><div style="font-size:26px;font-family:'Instrument Serif',serif">${janela(20)}</div>
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">por 20 respostas</div></div>
      <div><div style="font-size:26px;font-family:'Instrument Serif',serif;color:${maxRun>=6?'var(--accent)':'var(--ink)'}">${maxRun}</div>
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">maior sequência seguida</div></div>
      <div><div style="font-size:26px;font-family:'Instrument Serif',serif">${seq.length}</div>
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">respostas analisadas</div></div>
    </div>
    ${maxRun>=6?`<div style="font-size:12px;color:var(--aviso-ink);background:var(--aviso-bg);border:1px solid var(--aviso-bd);border-radius:8px;padding:9px 11px;margin-bottom:14px">A maior sequência foi de <strong>${maxRun}</strong> respostas seguidas de <strong>${esc(matRun)}</strong>.</div>`:''}
    <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Quanto de cada matéria</div>
    ${ord.map(([m,n])=>`<div style="display:flex;align-items:center;gap:10px;margin-bottom:5px">
      <div style="flex:0 0 46%;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m)}</div>
      <div style="flex:1;height:7px;background:var(--surface2);border-radius:4px;overflow:hidden">
        <div style="height:100%;width:${Math.round(n/mx*100)}%;background:var(--accent2);border-radius:4px"></div></div>
      <div style="flex:0 0 58px;text-align:right;font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--muted)">${n} · ${Math.round(n/seq.length*100)}%</div>
    </div>`).join('')}`;
}
function renderStats(){renderDesempenhoPeriodo();renderSubtemas();renderMistura();const ac=questions.reduce((a,q)=>a+(q.acertos||0),0),er=questions.reduce((a,q)=>a+(q.erros||0),0),pct=(ac+er)>0?Math.round(ac/(ac+er)*100):null;document.getElementById('st-total').textContent=questions.length;document.getElementById('st-ac').textContent=ac;document.getElementById('st-er').textContent=er;document.getElementById('st-pct').textContent=pct!==null?pct+'%':'—';const byMat={};questions.forEach(q=>{const m=q.materia||'Sem matéria';if(!byMat[m])byMat[m]={ac:0,er:0,tot:0};byMat[m].ac+=q.acertos||0;byMat[m].er+=q.erros||0;byMat[m].tot++;});const mxT=Math.max(...Object.values(byMat).map(v=>v.ac+v.er),1);document.getElementById('mat-chart').innerHTML=Object.entries(byMat).sort((a,b)=>b[1].tot-a[1].tot).slice(0,7).map(([nm,v])=>{const t=v.ac+v.er,p=t>0?Math.round(v.ac/t*100):0,w=t>0?Math.round(t/mxT*100):5;return`<div class="mat-row"><div class="mat-row-h"><span class="mat-name">${nm}</span><span class="mat-pct">${t>0?p+'%':v.tot+' q'}</span></div><div class="prog-bar"><div class="prog-fill" style="width:${w}%"></div></div></div>`;}).join('')||'<div style="color:var(--muted);font-size:13px">Sem dados</div>';const mxCount=Math.max(...Object.values(byMat).map(v=>v.tot),1);document.getElementById('mat-count-chart').innerHTML=Object.entries(byMat).sort((a,b)=>a[1].tot-b[1].tot).map(([nm,v])=>{const w=Math.round(v.tot/mxCount*100);return`<div class="mat-row"><div class="mat-row-h"><span class="mat-name">${esc(nm)}</span><span class="mat-pct">${v.tot} q</span></div><div class="prog-bar"><div class="prog-fill" style="width:${w}%;background:var(--accent2)"></div></div></div>`;}).join('')||'<div style="color:var(--muted);font-size:13px">Sem dados</div>';const byBan={};questions.forEach(q=>{const b=q.banca||'Outras';byBan[b]=(byBan[b]||0)+1;});const sorted=Object.entries(byBan).sort((a,b)=>b[1]-a[1]).slice(0,6),mx=Math.max(...sorted.map(([,v])=>v),1),cols=['var(--accent)','var(--accent2)','var(--green)','var(--yellow)','#8b5cf6','#ec4899'];document.getElementById('banca-chart').innerHTML=sorted.map(([nm,cnt],i)=>`<div class="bar-g"><div class="bar-v">${cnt}</div><div class="bar-b" style="height:${Math.round(cnt/mx*100)}%;background:${cols[i%cols.length]}"></div><div class="bar-l">${nm.substring(0,7)}</div></div>`).join('')||'<div style="color:var(--muted);font-size:13px">Sem dados</div>';}

// BACKUP — EXPORTAR
// ===== BACKUP COMPLETO =====
// Até a versão anterior o .json levava só as questões. Histórico por dia (gráfico
// "Atividade por dia" e tempo estudado), registro de respostas (Dashboard, Ranking,
// Meta), resumos, flashcards e configurações ficavam para trás — ao abrir o app em
// outro endereço ou aparelho, tudo isso sumia mesmo depois de importar o backup.
// Agora vai tudo junto em "extras". Backups antigos, sem extras, continuam valendo.
const LS_FORA_DO_BACKUP=['questia_v3','questia_apikey','questia_senha_servidor','questia_last_export',
  'questia_qtd_ultimo_export','questia_last_save_ts','questia_test','questia_apibar'];
function chaveVaiNoBackup(k){
  if(!/^(questia_|qia_)/.test(k))return false;
  if(LS_FORA_DO_BACKUP.includes(k))return false;
  return !/^questia_(snap_|v3_RESGATE_)/.test(k);   // cópias de segurança antigas e chave da API ficam de fora
}
async function coletarExtras(){
  const ls={};
  try{Object.keys(localStorage).filter(chaveVaiNoBackup).forEach(k=>ls[k]=localStorage.getItem(k));}catch(e){}
  let respostas=[],rankingHist=null;
  try{respostas=(await lerLog()).map(({seq,...r})=>r);}catch(e){}
  try{if(idbOk)rankingHist=await idbLer(ST_META,'ranking_hist');}catch(e){}
  return{hist:histCache||{},respostas,rankingHist:rankingHist||null,localStorage:ls};
}
async function exportarBanco(){
  if(questions.length===0){notify('Banco vazio — nada para exportar','err');return;}
  const extras=await coletarExtras();
  const payload={versao:'2.0',exportadoEm:new Date().toISOString(),totalQuestoes:questions.length,questoes:questions,extras};
  const blob=new Blob([JSON.stringify(payload)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  const dateStr=new Date().toLocaleDateString('pt-BR').replace(/\//g,'-');
  a.href=url;a.download=`questia-backup-${dateStr}.json`;a.click();URL.revokeObjectURL(url);
  try{localStorage.setItem('questia_last_export',new Date().toISOString());
      localStorage.setItem('questia_qtd_ultimo_export',String(questions.length));}catch(e){}
  renderBackupInfo();
  notify(`✓ Backup completo: ${questions.length} questões, ${Object.keys(extras.hist).length} dias de histórico, ${extras.respostas.length} respostas`,'ok');
}
// Restaura os extras de um backup. "substituir" troca tudo pelo do arquivo;
// "mesclar" só acrescenta o que falta, sem apagar nada que já está neste navegador.
function totalDia(h){return h?(h.ac||0)+(h.er||0):0;}
function mesclarListaPorId(atualJson,novoJson){
  let a=[],b=[];try{a=JSON.parse(atualJson||'[]');}catch(e){}try{b=JSON.parse(novoJson||'[]');}catch(e){}
  if(!Array.isArray(a)||!Array.isArray(b))return novoJson;
  const ids=new Set(a.map(x=>x&&x.id));
  return JSON.stringify(a.concat(b.filter(x=>x&&!ids.has(x.id))));
}
// O histórico por dia (gráfico "Atividade por dia", tempo estudado) é um contador,
// e contador de dois aparelhos não se mescla sem duplicar ou perder. O registro de
// respostas guarda cada resposta com data e hora, então dá para unir sem repetir.
// Por isso o registro manda: se um dia tem MAIS respostas no registro do que no
// histórico (estudou nos dois sites no mesmo dia), o dia é recontado a partir do
// registro. Nunca diminui um dia — só corrige o que ficou contado a menos.
async function reconciliarHistComLog(){
  if(!idbOk)return 0;
  let L=[];try{L=await lerLog();}catch(e){return 0;}
  const porDia={};
  L.forEach(r=>{if(!r||typeof r.ts!=='number')return;const d=r.dia||ymd(new Date(r.ts));(porDia[d]=porDia[d]||[]).push(r);});
  let n=0;
  Object.entries(porDia).forEach(([d,rs])=>{
    const atual=histCache[d];
    if(rs.length<=totalDia(atual))return;
    const novo={ac:0,er:0,ms:0,mat:{}};
    rs.forEach(r=>{
      if(r.nota===0)novo.er++;else novo.ac++;
      if(r.ms>0){
        let m=(r.materia||'').trim()||'Sem matéria';
        if(typeof MATERIAS_UNIFICAR!=='undefined'&&MATERIAS_UNIFICAR[m])m=MATERIAS_UNIFICAR[m];
        novo.ms+=r.ms;novo.mat[m]=(novo.mat[m]||0)+r.ms;
      }
    });
    if(atual){
      novo.ms=Math.max(novo.ms,atual.ms||0);
      Object.entries(atual.mat||{}).forEach(([m,v])=>{if((novo.mat[m]||0)<v)novo.mat[m]=v;});
    }
    histCache[d]=novo;n++;
  });
  if(n)salvarHist();
  return n;
}
// Campos de estudo de uma questão (agendamento e contadores). Na mesclagem, uma
// questão que existe nos dois lados fica com o estado do lado que a respondeu por
// último — o conteúdo (enunciado, gabarito corrigido) continua o deste navegador.
const CAMPOS_ESTUDO=['reps','ef','interval','nextDue','ultimaErrada','refAcerto','firmeOk','consolidada','suspensa','favorita'];
async function atualizarProgressoMesclado(importadas,respostasImp){
  if(!idbOk||!Array.isArray(respostasImp)||!respostasImp.length)return 0;
  const ultimo=arr=>{const m=new Map();arr.forEach(r=>{if(r&&typeof r.ts==='number'&&(m.get(r.qid)||0)<r.ts)m.set(r.qid,r.ts);});return m;};
  const ultImp=ultimo(respostasImp);
  let ultLoc;try{ultLoc=ultimo(await lerLog());}catch(e){return 0;}
  const porId=new Map(questions.map(q=>[q.id,q]));
  let n=0;
  importadas.forEach(qi=>{
    const q=porId.get(qi.id);if(!q)return;
    if((ultImp.get(qi.id)||0)<=(ultLoc.get(qi.id)||0))return;   // este navegador já tem a resposta mais recente
    const ac=Math.max(q.acertos||0,qi.acertos||0),er=Math.max(q.erros||0,qi.erros||0);
    CAMPOS_ESTUDO.forEach(c=>{if(qi[c]!==undefined)q[c]=qi[c];});
    q.acertos=ac;q.erros=er;
    n++;
  });
  return n;
}
async function aplicarExtras(ex,modo){
  const subst=modo==='substituir',res={dias:0,respostas:0,chaves:0};
  // 1) histórico por dia
  if(ex.hist&&typeof ex.hist==='object'){
    if(subst){histCache=ex.hist;res.dias=Object.keys(ex.hist).length;}
    else Object.entries(ex.hist).forEach(([d,h])=>{if(totalDia(h)>totalDia(histCache[d])){histCache[d]=h;res.dias++;}});
    salvarHist();
  }
  // 2) registro de respostas (Dashboard, Ranking, Meta)
  if(idbOk&&Array.isArray(ex.respostas)&&ex.respostas.length){
    const atuais=subst?[]:await lerLog();
    const vistos=new Set(atuais.map(r=>r.ts+'|'+r.qid));
    const tx=db.transaction(ST_LOG,'readwrite'),st=tx.objectStore(ST_LOG);
    if(subst)st.clear();
    ex.respostas.forEach(r=>{
      if(!r||typeof r.ts!=='number')return;
      const k=r.ts+'|'+r.qid;if(vistos.has(k))return;vistos.add(k);
      const {seq,...limpo}=r;st.add(limpo);res.respostas++;
    });
    await txFim(tx);
  }
  // 3) ranking guardado
  if(idbOk&&ex.rankingHist&&typeof ex.rankingHist==='object'){
    let atual={};try{atual=(await idbLer(ST_META,'ranking_hist'))||{};}catch(e){}
    await idbGravar(ST_META,subst?ex.rankingHist:Object.assign({},ex.rankingHist,atual),'ranking_hist');
    try{rkCarregado=false;rkHist={};}catch(e){}
  }
  // 4) resumos, flashcards e configurações
  if(ex.localStorage&&typeof ex.localStorage==='object'){
    Object.entries(ex.localStorage).forEach(([k,v])=>{
      if(!chaveVaiNoBackup(k)||typeof v!=='string')return;
      try{
        const atual=localStorage.getItem(k);
        let final=v;
        if(!subst&&atual!==null){
          if(k==='questia_resumos'||k==='questia_cards')final=mesclarListaPorId(atual,v);
          else if(k==='questia_rev_hist'){
            const a=JSON.parse(atual||'{}'),b=JSON.parse(v||'{}');
            Object.keys(b).forEach(d=>{a[d]=Math.max(a[d]||0,b[d]||0);});final=JSON.stringify(a);
          }else return;                 // configuração que já existe aqui: mantém a deste navegador
        }
        if(final!==atual){localStorage.setItem(k,final);res.chaves++;}
      }catch(e){}
    });
    loadResumos();
    if(typeof loadCards==='function')loadCards();
  }
  // 5) recontar os dias em que os dois aparelhos estudaram
  if(!subst)res.dias+=await reconciliarHistComLog();
  return res;
}
async function renderBackupInfo(){
  document.getElementById('bi-total').textContent=questions.length;
  document.getElementById('bi-respondidas').textContent=questions.filter(q=>((q.acertos||0)+(q.erros||0))>0).length;
  document.getElementById('bi-acertos').textContent=questions.reduce((a,q)=>a+(q.acertos||0),0);
  document.getElementById('bi-erros').textContent=questions.reduce((a,q)=>a+(q.erros||0),0);
  let le=null;try{le=localStorage.getItem('questia_last_export');}catch(e){}
  document.getElementById('bi-ultimo').textContent=le?new Date(le).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'nunca';

  // Medidor de espaço — o que faltava para o problema da cota ser visível antes de doer
  const esp=document.getElementById('espaco-info');
  if(esp){
    const e=await medirEspaco();
    const antigo=tamanhoLocalStorageAntigo();
    let html='';
    if(!idbOk){
      html=`<div class="import-warning" style="margin:0">⚠️ <strong>Modo antigo (localStorage).</strong> O IndexedDB não pôde ser aberto neste navegador, então vale o teto de ~5 MB. Exporte backups com frequência.</div>`;
    }else{
      const pct=e&&e.cota?Math.min(100,e.uso/e.cota*100):0;
      const cor=pct>80?'var(--accent)':pct>60?'var(--yellow)':'var(--green)';
      html=`<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px">
          <span style="color:var(--muted)">Espaço usado pelo QuestIA</span>
          <span style="font-family:'JetBrains Mono',monospace">${e?fmtBytes(e.uso)+' de '+fmtBytes(e.cota)+' ('+pct.toFixed(1)+'%)':'—'}</span>
        </div>
        <div class="prog-bar"><div class="prog-fill" style="width:${Math.max(pct,1)}%;background:${cor}"></div></div>
        <div style="font-size:12px;color:var(--muted);margin-top:8px">
          ${e&&e.persistente?'🔒 Armazenamento persistente ativo — o navegador não vai descartar seus dados sozinho.':'⚠️ Armazenamento não persistente: em disco muito cheio o navegador pode descartar os dados. Mantenha o backup .json em dia.'}
        </div>`;
      if(antigo>0){
        html+=`<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border);display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <span style="font-size:12px;color:var(--muted);flex:1;min-width:240px">Cópia antiga no localStorage ocupando <strong>${fmtBytes(antigo)}</strong>. Ela ficou de propósito como rede de segurança da migração. Depois de conferir que está tudo certo, pode liberar.</span>
          <button class="btn btn-outline btn-sm" onclick="liberarLocalStorageAntigo()">Liberar espaço antigo</button>
        </div>`;
      }
    }
    esp.innerHTML=html;
  }

  const sl=document.getElementById('snap-list');
  if(sl){
    const snaps=await listarSnapshots();
    sl.innerHTML=snaps.length?snaps.map(s=>`<div class="import-preview-row"><span><strong style="font-family:'JetBrains Mono',monospace;font-size:12px">${s.data}</strong> <span style="color:var(--muted);font-size:12px">— ${s.qtd} questões</span></span><button class="btn btn-outline btn-sm" onclick="restaurarSnapshot('${s.chave}')">Restaurar</button></div>`).join('')
      :'<div style="color:var(--muted);font-size:13px">Nenhum snapshot ainda — o primeiro é criado assim que você abrir o app com questões no banco.</div>';
  }
}

// BACKUP — IMPORTAR
function handleImportDrop(e){const file=e.dataTransfer.files[0];if(file)iniciarImport({target:{files:[file]}});}
function iniciarImport(event){
  const file=event.target.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const data=JSON.parse(e.target.result);
      const questoes=data.questoes||(Array.isArray(data)?data:null);
      if(!questoes||!questoes.length){notify('Arquivo inválido ou sem questões','err');return;}
      pendingImportData=questoes;pendingImportExtras=(data&&data.extras&&typeof data.extras==='object')?data.extras:null;
      document.getElementById('import-warning').innerHTML=questions.length>0?`<strong>⚠️ Atenção:</strong> Você tem ${questions.length} questão(ões) no banco atual. Escolha como proceder abaixo.`:`<strong>ℹ️ Banco vazio.</strong> As questões serão adicionadas normalmente.`;
      const ac=questoes.reduce((a,q)=>a+(q.acertos||0),0),er=questoes.reduce((a,q)=>a+(q.erros||0),0),mats=[...new Set(questoes.map(q=>q.materia).filter(Boolean))];
      document.getElementById('import-preview').innerHTML=`<div class="import-preview-row"><span class="import-preview-label">Questões no arquivo</span><span class="import-preview-val">${questoes.length}</span></div><div class="import-preview-row"><span class="import-preview-label">Matérias</span><span class="import-preview-val" style="font-family:inherit;font-size:12px">${mats.join(', ')||'—'}</span></div><div class="import-preview-row"><span class="import-preview-label">Acertos registrados</span><span class="import-preview-val">${ac}</span></div><div class="import-preview-row"><span class="import-preview-label">Erros registrados</span><span class="import-preview-val">${er}</span></div>${(()=>{const x=data&&data.extras;if(!x)return '<div class="import-preview-row"><span class="import-preview-label">Histórico, resumos e estatísticas</span><span class="import-preview-val" style="font-family:inherit;font-size:12px;color:var(--yellow)">não vêm neste arquivo (backup antigo, só questões)</span></div>';let nr=0,nc=0;try{nr=JSON.parse((x.localStorage||{}).questia_resumos||'[]').length;nc=JSON.parse((x.localStorage||{}).questia_cards||'[]').length;}catch(e){}return '<div class="import-preview-row"><span class="import-preview-label">Dias de histórico</span><span class="import-preview-val">'+Object.keys(x.hist||{}).length+'</span></div><div class="import-preview-row"><span class="import-preview-label">Respostas registradas</span><span class="import-preview-val">'+((x.respostas||[]).length)+'</span></div><div class="import-preview-row"><span class="import-preview-label">Resumos · flashcards</span><span class="import-preview-val">'+nr+' · '+nc+'</span></div>';})()}<div class="import-preview-row"><span class="import-preview-label">Exportado em</span><span class="import-preview-val" style="font-family:inherit;font-size:12px">${data.exportadoEm?new Date(data.exportadoEm).toLocaleDateString('pt-BR'):'—'}</span></div>`;
      document.getElementById('import-modal').classList.add('open');
      document.getElementById('import-file').value='';
    }catch(err){notify('Erro ao ler arquivo: JSON inválido','err');}
  };
  reader.readAsText(file);
}
async function confirmarImport(modo){
  if(!pendingImportData)return;
  document.getElementById('import-modal').classList.remove('open');
  // Preserva todos os dados do SM-2 (nextDue, reps, ef, interval) intactos
  function importQ(q){
    return {
      id: q.id||(Date.now()+Math.random()),
      questao: q.questao||'',
      alternativas: q.alternativas||[],
      gabarito: q.gabarito??0,
      gabTexto: q.gabTexto||(q.alternativas||[])[q.gabarito??0]||'',
      ...(q.conflito?{conflito:q.conflito}:{}),
      comentario: q.comentario||'',
      // Backup antigo traz tudo grudado no subtema; backup novo já vem separado.
      ...(q.origem!==undefined
          ? {subtema:String(q.subtema||'').trim(), origem:String(q.origem||'')}
          : separarOrigem(q.subtema)),
      materia: (q.materia||'').trim(),
      banca: q.banca||'',
      // O 'fonte' separa questão de banca de questão gerada por IA, e comanda três
      // coisas: se entra na projeção de nota, se recebe o teto da reta final e se
      // disputa a cota de questões novas. Perder esse campo ao restaurar um backup
      // fazia a questão sumir da Meta em silêncio — sem virar "matéria órfã", sem
      // erro nenhum. Por isso é preservado, com o 'origem' como segunda pista.
      fonte: q.fonte||(/^TecConcursos #/.test(String(q.origem||''))?'tec':'ia'),
      ...(q.resultadoTec?{resultadoTec:q.resultadoTec,assinaladaTec:q.assinaladaTec||null}:{}),
      ...(q.conflitoDecidido?{conflitoDecidido:q.conflitoDecidido}:{}),
      ...(q.gabDeComentario?{gabDeComentario:true}:{}),
      ...(q.pratico?{pratico:q.pratico}:{}),   // "Na prática" já gerado — não gastar crédito de novo
      // SM-2 — preserva exatamente o que estava no backup
      reps: q.reps??0,
      ef: q.ef??2.5,
      interval: q.interval??0,
      nextDue: q.nextDue||today(), // preserva a data agendada!
      acertos: q.acertos||0,
      erros: q.erros||0,
      suspensa: q.suspensa||false,
      favorita: q.favorita||false,
      ...(q.comentarioPessoal?{comentarioPessoal:q.comentarioPessoal}:{}),
      consolidada: q.consolidada||false,
    };
  }
  if(modo==='substituir'){questions=pendingImportData.map(importQ);}
  else{const ids=new Set(questions.map(q=>q.id));const novas=pendingImportData.filter(q=>!ids.has(q.id)).map(importQ);
    const progresso=pendingImportExtras?await atualizarProgressoMesclado(pendingImportData,pendingImportExtras.respostas):0;
    {const porIdC=new Map(questions.map(q=>[q.id,q]));pendingImportData.forEach(qi=>{const q=porIdC.get(qi.id);if(q&&qi.comentarioPessoal&&(!q.comentarioPessoal||(qi.comentarioPessoal.em||'')>(q.comentarioPessoal.em||'')))q.comentarioPessoal=qi.comentarioPessoal;});}
    if(progresso)setTimeout(()=>notify(`✓ Progresso atualizado em ${progresso} questões respondidas no outro aparelho`,'ok'),5000);
    questions.push(...novas);const dup=pendingImportData.length-novas.length;if(dup>0)notify(`Mesclado! ${novas.length} adicionadas, ${dup} já existiam.`,'ok');}
  save();pendingImportData=null;
  if(pendingImportExtras){
    try{
      const r=await aplicarExtras(pendingImportExtras,modo);
      setTimeout(()=>notify(`✓ Histórico restaurado: ${r.dias} dias, ${r.respostas} respostas, ${r.chaves} itens (resumos, cards, configurações)`,'ok'),2500);
    }catch(err){console.error('[QuestIA] extras do backup:',err);setTimeout(()=>notify('⚠️ Questões importadas, mas o histórico falhou: '+(err&&err.message||err),'err'),2500);}
    pendingImportExtras=null;
  }
  updateSidebar();renderBackupInfo();
  notify(modo==='substituir'?`✓ Banco substituído com ${questions.length} questões!`:`✓ ${questions.length} questões no banco após mesclagem!`,'ok');
}
// ===== APLICAR TAXONOMIA =====
// Recebe o .json de taxonomia (id -> subtema/materia/origem) e atualiza SÓ esses
// três campos. Repetições, facilidade, intervalo, agendamento, acertos e erros do
// SM-2 não são tocados — casa por id, não substitui a questão.
function escolherTaxonomia(){document.getElementById('tax-file').click();}
function carregarTaxonomia(event){
  const input=event.target;
  const file=input.files&&input.files[0];if(!file)return;
  // O campo só é limpo DEPOIS da leitura. Limpar antes descarta a seleção e o
  // FileReader devolve vazio — que virava "JSON inválido" sem explicar nada.
  const limpar=()=>{try{input.value='';}catch(e){}};
  const reader=new FileReader();
  reader.onerror=()=>{limpar();notify('Não consegui ler o arquivo: '+((reader.error&&reader.error.name)||'erro desconhecido'),'err');};
  reader.onload=e=>{
    limpar();
    const bruto=e.target.result;
    if(!bruto||!String(bruto).trim()){notify('O arquivo veio vazio na leitura. Tente selecioná-lo de novo.','err');return;}
    let dados;
    try{dados=JSON.parse(bruto);}
    catch(err){
      alert('Esse arquivo não é um JSON válido.\n\nArquivo: '+file.name+'\nTamanho: '+file.size+' bytes\nComeça com: "'+String(bruto).slice(0,70).replace(/\s+/g,' ')+'..."\n\nO arquivo certo é o questia-taxonomia.json.');
      return;
    }
    const mapa=dados.mapa||(Array.isArray(dados)?dados:null);
    if(!Array.isArray(mapa)||!mapa.length){notify('Arquivo sem mapa de taxonomia','err');return;}
    const porId=new Map(mapa.map(m=>[m.id,m]));
    let casadas=0,materiasMudadas=0,reativadas=0,suspensasNovas=0;
    const novasMaterias=new Set();
    questions.forEach(q=>{if(porId.has(q.id)){casadas++;const m=porId.get(q.id);
      if(m.materia&&m.materia!==(q.materia||'').trim()){materiasMudadas++;novasMaterias.add(m.materia);}
      // O campo "suspensa" é OPCIONAL no arquivo: sem ele, o estado atual da questão
      // não é tocado. Existe porque questão suspensa por matéria fora do EDITAL não
      // volta sozinha quando a matéria é corrigida — e reativar centenas na mão, uma
      // a uma no Banco, não é viável. O número aparece no aviso antes de aplicar.
      if(m.suspensa!==undefined){ if(!m.suspensa&&q.suspensa)reativadas++; if(m.suspensa&&!q.suspensa)suspensasNovas++; }}});
    const orfas=questions.length-casadas;
    if(!casadas){notify('Nenhuma questão do arquivo bate com o seu banco','err');return;}
    const aviso=`Aplicar a taxonomia?\n\n`+
      `• ${casadas} questões recebem subtema novo\n`+
      `• ${materiasMudadas} mudam de matéria\n`+
      (reativadas?`• ${reativadas} são REATIVADAS (voltam para a fila)\n`:'')+
      (suspensasNovas?`• ${suspensasNovas} são SUSPENSAS (saem da fila)\n`:'')+
      (orfas?`• ${orfas} do seu banco não estão no arquivo — ficam como estão\n`:'')+
      `\nAgendamento, acertos, erros e facilidade do SM-2 NÃO são alterados.\nA procedência antiga vai para o campo "origem".`;
    if(!confirm(aviso))return;
    questions.forEach(q=>{
      const m=porId.get(q.id);if(!m)return;
      q.origem = m.origem!==undefined ? m.origem : (q.origem||q.subtema||'');
      q.subtema = m.subtema||'';
      if(m.materia) q.materia = m.materia;
      if(m.suspensa!==undefined) q.suspensa = !!m.suspensa;
    });
    // Questões fora do arquivo ainda podem ter subtema inchado — separa pela regra.
    let normalizadas=0;
    questions.forEach(q=>{
      if(porId.has(q.id))return;
      if(q.origem!==undefined&&q.origem!=='')return;
      if((q.subtema||'').length<=LIMITE_SUBTEMA)return;
      const sep=separarOrigem(q.subtema);q.subtema=sep.subtema;q.origem=sep.origem;normalizadas++;
    });
    save();updateSidebar();renderBackupInfo();
    notify(`✓ Taxonomia aplicada — ${casadas} questões${normalizadas?`, ${normalizadas} normalizadas pela regra`:''}`,'ok');
  };
  reader.readAsText(file);
}

// ===== CONSERTO DE TABELAS ACHATADAS =====
// Até a v2.4.0 do coletor, htmlToMarkdownText terminava em .textContent, que
// descarta a estrutura de <table> inteira — e, pior, <td></td> VAZIO não
// deixava rastro nenhum. Sem as células em branco não dá para saber de que
// coluna era cada número: a informação não ficou bagunçada, ficou perdida.
// Nenhuma heurística daqui traz de volta o que não foi gravado, então o
// conserto é buscar o enunciado de novo no TEC e sobrepor SÓ ele.
// O que a correção devolve de ESTRUTURA que o banco não tem. Serve de porteiro:
// sem ganho, a questão é descartada em vez de sobrescrita à toa.
function temImagemMarcada(t){return /\[\[IMG-URL:/.test(String(t||''));}
function ganhoEstrutural(novo,atual){
  const g=[];
  if(temTabelaRenderizavel(novo)&&!temTabelaRenderizavel(atual))g.push('tabela');
  if(temImagemMarcada(novo)&&!temImagemMarcada(atual))g.push('imagem');
  // Tabela que chegou com várias linhas do TEC espremidas numa célula só
  // ("500 400 300 400 800"): a correção só vale se desfaz o empilhamento e
  // devolve mais linhas de tabela do que o banco tem hoje.
  if(temCelulaEmpilhada(atual)&&!temCelulaEmpilhada(novo)&&linhasDeTabela(novo)>linhasDeTabela(atual))g.push('tabela desempilhada');
  return g;
}
const RE_CELULA_EMPILHADA=/^\s*(\*\*)?[(−–-]?\s*\d[\d.,]*\)?%?(\*\*)?(\s+(\*\*)?[(−–-]?\s*\d[\d.,]*\)?%?(\*\*)?)+\s*$/;
function temCelulaEmpilhada(t){
  // negrito/itálico (*, **, ***) e "R$" não atrapalham: "***765.000*** 540.000 -" e
  // "R$ 1.900.000,00 R$ 800,00 2.500" também são células empilhadas
  const limpa=c=>c.replace(/\*+/g,'').replace(/R\$\s*/g,'').replace(/(^|\s)-(?=\s|$)/g,'$10');
  return String(t||'').split('\n').some(l=>/\S\s*\|\s*\S/.test(l)&&l.split('|').some(c=>RE_CELULA_EMPILHADA.test(limpa(c))));
}
function linhasDeTabela(t){return String(t||'').split('\n').filter(l=>/\S\s*\|\s*\S/.test(l)).length;}
function temTabelaRenderizavel(t){return /\S\s*\|\s*\S/.test(String(t||''));}
const RE_LINHA_VALOR=/^\(?-?\s*(?:R\$|US\$|€)?\s*-?\d[\d.,]*\)?%?$/;
function sinaisDeTabelaAchatada(t){
  t=String(t||'');
  if(temTabelaRenderizavel(t))return 0;             // já está boa
  return t.split('\n').map(l=>l.trim()).filter(Boolean).filter(l=>RE_LINHA_VALOR.test(l)).length;
}
function questoesComTabelaAchatada(){
  // Só questões de banca: o id delas é o QID do TecConcursos, que é como o
  // extrator busca. Questão gerada por IA não existe lá.
  return questions.filter(q=>q.fonte==='tec'&&sinaisDeTabelaAchatada(q.questao)>=2);
}
function exportarListaTabelas(){
  const alvo=questoesComTabelaAchatada();
  if(!alvo.length){notify('Nenhuma questão com tabela achatada encontrada','ok');return;}
  const payload={tipo:'questia-tabelas-pedido',geradoEm:new Date().toISOString(),
    ids:alvo.map(q=>q.id),
    resumo:alvo.map(q=>({id:q.id,materia:q.materia||'',valoresSoltos:sinaisDeTabelaAchatada(q.questao)}))};
  const blob=new Blob([JSON.stringify(payload,null,1)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download='questia-tabelas-pedido.json';a.click();URL.revokeObjectURL(url);
  document.getElementById('tab-info').innerHTML=
    `<div class="backup-stat"><strong>${alvo.length}</strong> questões na lista. Leve o arquivo para o TEC.</div>`;
  notify(`✓ Lista de ${alvo.length} questões baixada`,'ok');
}
function carregarCorrecaoTabelas(event){
  const input=event.target;
  const file=input.files&&input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onerror=()=>{try{input.value='';}catch(e){}notify('Não consegui ler o arquivo','err');};
  reader.onload=e=>{
    try{input.value='';}catch(_){}
    let d;
    try{d=JSON.parse(e.target.result);}catch(err){notify('JSON inválido','err');return;}
    const itens=d.itens||(Array.isArray(d)?d:null);
    if(!Array.isArray(itens)||!itens.length){notify('Arquivo sem itens de correção','err');return;}
    const porId=new Map(questions.map(q=>[q.id,q]));
    let aplicar=[],semDono=0,semGanho=0;const ganhos={};
    itens.forEach(it=>{
      const q=porId.get(it.id);
      if(!q){semDono++;return;}
      // Só entra o que traz ESTRUTURA que o banco não tem — tabela OU imagem.
      // Antes o teste era só de tabela, então uma correção que trazia de volta a
      // figura de uma questão (mas nenhuma tabela) era descartada como "sem ganho".
      const g=ganhoEstrutural(it.enunciado,q.questao);
      if(!g.length){semGanho++;return;}
      g.forEach(t=>ganhos[t]=(ganhos[t]||0)+1);
      aplicar.push({q,novo:it.enunciado});
    });
    if(!aplicar.length){
      notify(`Nada a aplicar (${semDono} fora do banco, ${semGanho} sem ganho)`,'err');return;
    }
    const resumoGanhos=Object.entries(ganhos).map(([k,v])=>`${v} ${k}`).join(' · ');
    if(!confirm(`Sobrepor o enunciado de ${aplicar.length} questões?\n\n`
      +(resumoGanhos?`Recuperam: ${resumoGanhos}.\n\n`:'')
      +`Troca SOMENTE o texto do enunciado. Comentário do professor, gabarito, matéria, subtema, `
      +`repetições, facilidade, intervalo, data da próxima revisão, acertos e erros não são tocados. `
      +`Nenhuma questão é criada ou apagada.\n\n`
      +(semDono?`${semDono} do arquivo não estão neste banco e serão ignoradas.\n`:'')
      +(semGanho?`${semGanho} foram descartadas por não trazerem ganho.\n`:'')))return;
    aplicar.forEach(({q,novo})=>{q.questao=novo;});
    save();updateSidebar();renderBackupInfo();
    if(document.getElementById('page-estudar').classList.contains('active'))initStudy();
    document.getElementById('tab-info').innerHTML=
      `<div class="backup-stat"><strong>${aplicar.length}</strong> enunciados corrigidos`
      +(semDono?` · ${semDono} fora do banco`:'')+(semGanho?` · ${semGanho} sem ganho`:'')+`</div>`;
    notify(`✓ ${aplicar.length} enunciados corrigidos — nada mais foi alterado`,'ok');
  };
  reader.readAsText(file);
}

// ===== IMPORTAÇÃO DO COLETOR DO TECCONCURSOS =====
// Formato: blocos "## Questao N" com cabeçalho "### #QID - BANCA - ...", campos
// **Materia:** / **Assunto:** (a árvore do próprio site), alternativas "**A)**" e
// "## Comentario do professor". O QID vira o id da questão: é estável, então
// reimportar o mesmo caderno não duplica nada.
let pendingTec=null, tecParecidas=new Map(), tecRepetidas=[];

// ===== GABARITO ANCORADO NO TEXTO =====
// O índice sozinho é frágil: basta o coletor trocar uma letra, ou a ordem das
// alternativas mudar entre a captura e o comentário, para o app passar a ensinar
// a alternativa errada como certa. A defesa é guardar o TEXTO da alternativa
// correta junto da questão e, na hora de mostrar o cartão, achar esse texto entre
// as alternativas. Assim o gabarito acompanha o conteúdo, não a posição.
function gabNorm(s){
  return String(s||'').toLowerCase()
    .replace(/^[a-e]\)\s*/,'')
    .replace(/[*~=>`_#]/g,'')
    .normalize('NFD').replace(/[̀-ͯ]/g,'')
    .replace(/[^a-z0-9]/g,'');
}
// Comparação sensível à ORDEM das palavras (bigramas). Jaccard de palavras dava
// 100% para alternativas que são permutações uma da outra — "tática, operacional
// e estratégica" vs "estratégica, operacional e tática" — que é justamente o tipo
// de alternativa em que errar a ancoragem seria mais grave.
function gabBigramas(s){const o=[];for(let i=0;i<s.length-1;i++)o.push(s.slice(i,i+2));return o;}
function gabSim(a,b){
  a=gabNorm(a);b=gabNorm(b);
  if(!a||!b)return 0;
  if(a===b)return 1;
  const A=gabBigramas(a),B=gabBigramas(b);
  if(!A.length||!B.length)return 0;
  const m=new Map();for(const x of A)m.set(x,(m.get(x)||0)+1);
  let h=0;for(const x of B){const c=m.get(x)||0;if(c>0){h++;m.set(x,c-1);}}
  return 2*h/(A.length+B.length);
}
// Dado um texto de gabarito, qual alternativa ele é? Só responde quando a melhor
// candidata é claramente melhor que a segunda — empate significa que não dá para
// afirmar nada, e aí é mais honesto manter o índice original.
function acharAlternativa(alternativas,texto){
  if(!texto||!alternativas||alternativas.length<2)return -1;
  const sims=alternativas.map(a=>gabSim(a,texto));
  const ord=[...sims].sort((x,y)=>y-x);
  const mx=ord[0],seg=ord[1]??0;
  if(mx<0.62)return -1;              // não bate com nenhuma
  if(mx-seg<0.06)return -1;          // duas alternativas parecidas demais
  return sims.indexOf(mx);
}
// Índice da alternativa correta desta questão, preferindo a âncora de texto.
// Quando não há âncora (questões antigas, geradas por IA), cai no índice de sempre.
function indiceGabarito(q){
  const idx=q.gabarito??0;
  if(!q.gabTexto)return idx;
  const achado=acharAlternativa(q.alternativas,q.gabTexto);
  return achado>=0?achado:idx;
}
// Extrai o texto que vem depois da letra numa linha tipo "D) apesar da gravidade…"
function textoDepoisDaLetra(s){
  const m=String(s||'').match(/^\s*\**([A-E])\)\**\s*([\s\S]+)$/);
  return m?m[2].replace(/\(dados internos do TEC\)\s*$/,'').trim():'';
}

// ===== SEGUNDA OPINIÃO: O COMENTÁRIO DO PROFESSOR =====
// Achado real conferindo o banco: existe questão cuja própria linha "Gabarito:" do
// arquivo está errada — letra e texto batem entre si, mas contradizem o professor,
// que explica alternativa por alternativa qual está certa. Nenhuma ancoragem de
// índice pega isso; só ler o comentário pega. O professor do TEC segue um padrão
// firme: repete cada alternativa ("**b)** …") e crava o veredito em negrito
// ("**CORRETO.**" / "**INCORRETA.**"). Só o veredito em negrito conta — "correta"
// solto no meio da explicação apareceria em quase todas e não quer dizer nada.
// Junta os três sinais de gabarito que um arquivo do TEC oferece e decide:
//   1. a LETRA na linha "Gabarito:"            (o que o app usava sozinho até agora)
//   2. o TEXTO da alternativa correta          (mesma linha, e no Capturas mais uma vez)
//   3. o COMENTÁRIO do professor               (independente dos outros dois)
// A letra é o palpite inicial. O texto corrige erro de leitura de letra sem alarde,
// porque texto e letra vêm do mesmo lugar e o texto é mais específico. Já o professor
// é fonte independente: quando ele contradiz os outros dois, ninguém pode decidir no
// automático — a questão entra marcada como conflito, para você olhar.
function ancorarGabarito({alternativas,gabarito,comentario,textoFonte}){
  let idx=gabarito,conflito=null;
  // (2) o texto do arquivo aponta outra alternativa? ele manda.
  const porTexto=acharAlternativa(alternativas,textoFonte);
  if(porTexto>=0&&porTexto!==idx){idx=porTexto;conflito={tipo:'letra-vs-texto',de:gabarito,para:porTexto};}
  // (3) e o professor, concorda?
  const prof=gabaritoPeloComentario(comentario);
  if(prof){
    const idxProf=acharAlternativa(alternativas,prof.texto);
    const alvo=idxProf>=0?idxProf:'ABCDE'.indexOf(prof.letra);
    if(alvo>=0&&alvo<alternativas.length&&alvo!==idx)
      conflito={tipo:'professor',de:idx,para:alvo,letraProf:prof.letra,conf:prof.conf};
  }
  return {gabarito:idx,gabTexto:alternativas[idx]||'',conflito};
}

// Item Certo/Errado: duas alternativas cujo texto é literalmente "Certo" e "Errado".
// No formato Capturas elas vêm rotuladas **C)** e **E)** — as letras são as iniciais
// das palavras, não posições, e é por isso que aqui tudo se resolve pelo texto.
function ehCertoErrado(alts){
  return alts&&alts.length===2&&alts.every(a=>/^(certo|errado)\b/i.test(String(a).trim()));
}
// Veredito global do comentário num item Certo/Errado. O professor abre com
// "**CORRETO.**", "**ITEM ERRADO**.", "**ASSERTIVA CORRETA**" e variações — o
// substantivo antes do adjetivo muda, o adjetivo não. Medido nos seus arquivos:
// recuperou o gabarito de 97 de 97 itens que a macro deixou sem resultado.
function vereditoCertoErrado(com){
  if(!com)return null;
  const corpo=String(com)
    .replace(/^\s*\*\*(Professor|Data do coment[áa]rio):\*\*.*$/gm,'')
    .slice(0,1200);
  const m=corpo.match(/\*\*\s*(?:(?:O\s+)?(?:ITEM|AFIRMA(?:TIVA|ÇÃO)|ASSERTIVA|QUEST[ÃA]O|ENUNCIADO|ALTERNATIVA|GABARITO)\s*:?\s*)?(CORRET[AO]|INCORRET[AO]|ERRAD[AO]|CERT[AO]|VERDADEIR[AO]|FALS[AO])\b[^*]{0,6}\*\*/i);
  if(!m)return null;
  return /^(INCORRET|ERRAD|FALS)/i.test(m[1])?'errado':'certo';
}
function gabaritoPeloComentario(com){
  if(!com||com.length<80)return null;
  const re=/(?:^|\n)\s*(?:\*\*)?([a-eA-E])\)(?:\*\*)?\s*([\s\S]*?)(?=(?:\n)\s*(?:\*\*)?[a-eA-E]\)(?:\*\*)?|$)/g;
  const vistos={},trechos={};let m;
  while((m=re.exec(com))){
    const L=m[1].toUpperCase();
    if(vistos[L]!==undefined)continue;               // vale a primeira aparição de cada letra
    const cab=m[2].slice(0,400);
    const v=cab.match(/\*\*\s*(INCORRET[AO]|CORRET[AO]|ERRAD[AO]|CERT[AO]|VERDADEIR[AO]|FALS[AO])\b[^*]{0,3}\*\*/i);
    const corte=cab.search(/\b(INCORRET[AO]|CORRET[AO]|ERRAD[AO]|CERT[AO])\b/i);
    trechos[L]=(corte>0?cab.slice(0,corte):cab.slice(0,180)).replace(/[*~]/g,'').trim();
    vistos[L]=v?(/^(INCORRET|ERRAD|FALS)/i.test(v[1])?'errada':'certa'):null;
  }
  const letras=Object.keys(vistos);
  if(letras.length<2)return null;
  const certas=letras.filter(l=>vistos[l]==='certa');
  if(certas.length!==1)return null;                  // zero ou várias "certas" = não dá para afirmar
  const naoLidas=letras.filter(l=>vistos[l]===null);
  // Segunda testemunha dentro do próprio comentário: quase todo professor do TEC abre
  // com "Gabarito: Letra X". Quando esse cabeçalho bate com a alternativa que ele
  // marcou como certa item a item, são duas leituras independentes concordando — e a
  // confiança sobe mesmo que ele não tenha comentado todas as alternativas. Quando as
  // duas se contradizem (acontece: já vi cabeçalho trocado), a confiança cai, porque
  // aí nem o professor está coerente consigo mesmo.
  const mCab=com.slice(0,300).match(/Gabarito\s*:?\s*(?:\*\*)?\s*(?:letra\s*)?:?\s*([A-Ea-e])\b/i);
  const cab=mCab?mCab[1].toUpperCase():null;
  let conf;
  if(cab&&cab===certas[0])      conf='alta';
  else if(cab&&cab!==certas[0]) conf='media';
  else                          conf=naoLidas.length===0?'alta':'media';
  return {letra:certas[0],texto:trechos[certas[0]]||'',conf,
          cabecalho:cab,divergeCabecalho:!!(cab&&cab!==certas[0])};
}
// O comentário de alguns professores abre com um cabeçalho solto tipo "Gabarito:
// Letra E" antes de entrar alternativa por alternativa. Enquanto o cabeçalho bate
// com o veredito do corpo, ele é só redundante (a resposta já aparece destacada
// no cartão). Quando diverge — o caso real que motivou isto: cabeçalho diz E, mas
// o corpo julga cada alternativa e crava "CORRETO" em B, e é o corpo que o app usa
// como fonte da verdade — o cabeçalho ficava exibido do lado da alternativa ERRADA
// contradizendo visualmente o que o próprio cartão acabou de marcar de verde.
// Solução: tirar esse cabeçalho do texto mostrado, nos dois casos, porque ele nunca
// acrescenta nada que o destaque colorido já não diga, e às vezes atrapalha.
function limparCabecalhoGabaritoComentario(com){
  if(!com)return com;
  return com.replace(/^\s*\**\s*Gabarito\s*:?\s*\**\s*(?:letra\s*)?:?\s*[A-Ea-e]\b[^\n]*\n+/i,'').trimStart();
}
// Remonta o comentário do professor com a cara do comentário original do TEC
// (print que motivou isto): um cabeçalho "Gabarito: LETRA X" em destaque, seguido
// do texto com os veredictos "CORRETO"/"INCORRETO" (e variações) coloridos de
// verde/vermelho, do jeito que aparecem lá.
// A letra do cabeçalho é sempre RECALCULADA a partir do que o cartão está
// marcando como certo agora (parâmetro letraAtual) — nunca lida do texto bruto,
// que pode ter ficado desatualizado depois de uma correção de conflito e voltar
// a contradizer a alternativa destacada.
// Puxa um trecho enxuto e já limpo de HTML do comentário — usado apenas como
// referência interna (registro de origem), nunca pré-preenche a caixa que o
// usuário vê: essa fica sempre em branco, para ele escrever do zero.
function extrairTrechoComentario(comentario){
  if(!comentario)return'';
  let t=String(comentario)
    .replace(/<br\s*\/?>/gi,' ').replace(/<[^>]*>/g,' ')
    .replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'")
    .replace(/\s+/g,' ').trim();
  t=t.replace(/^(CORRETO|CORRETA)\s*:\s*/i,'');
  const LIM=280;
  if(t.length<=LIM)return t;
  let cut=t.slice(0,LIM);
  const pontoFinal=cut.lastIndexOf('. ');
  if(pontoFinal>80)return cut.slice(0,pontoFinal+1);
  const ultimoEspaco=cut.lastIndexOf(' ');
  return (ultimoEspaco>40?cut.slice(0,ultimoEspaco):cut)+'…';
}
// Converte um trecho de HTML (como o já renderizado em #fc-q ou #fc-ans-gabarito)
// em texto puro, preservando quebras de parágrafo — para colar em qualquer lugar
// (prompt de IA, Word, WhatsApp) sem levar tags junto.
function htmlParaTextoPuro(html){
  if(!html)return'';
  // fórmula desenhada pelo KaTeX volta ao LaTeX original (o HTML dela é ilegível como texto)
  if(/class="tex/.test(String(html))){const dv=document.createElement('div');dv.innerHTML=html;
    dv.querySelectorAll('.tex[data-tex]').forEach(e=>e.replaceWith(document.createTextNode(e.dataset.tex)));html=dv.innerHTML;}
  let t=String(html)
    .replace(/<br\s*\/?>/gi,'\n')
    // Tabela vira linhas "a | b | c" — sem isso as células saíam grudadas numa linha só
    .replace(/<\/t[dh]>\s*(?=<t[dh][\s>])/gi,' | ')
    .replace(/<\/tr>/gi,'\n')
    .replace(/<\/(p|div|li|h[1-6]|table)>/gi,'\n')
    .replace(/<li[^>]*>/gi,'- ')
    .replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi,'[Imagem: $1]')
    .replace(/<img[^>]*>/gi,'[Imagem]')
    .replace(/<[^>]+>/g,'');
  const ta=document.createElement('textarea');
  ta.innerHTML=t;
  t=ta.value;
  t=t.replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  return t;
}
// Monta o texto completo (enunciado + alternativas + gabarito + comentário do
// professor) da questão que está na tela do estudo agora, pronto para colar
// num prompt de IA.
function montarTextoQuestaoAtual(){
  const q=dueQueue[dueIdx];
  if(!q)return null;
  const meta=[q.materia,q.banca,q.subtema].filter(Boolean).join(' · ');
  const enunciado=htmlParaTextoPuro(document.getElementById('fc-q').innerHTML);
  // Alternativas na ORDEM ORIGINAL (a do TEC), não na embaralhada da tela: o
  // comentário do professor cita as letras originais, então com a ordem da tela
  // a IA via "letra B" no comentário e uma alternativa B diferente na lista.
  const botoes=[...document.querySelectorAll('#fc-alts .alt-btn')];
  const alts=botoes.map((b,i)=>({letra:b.getAttribute('data-orig')||String.fromCharCode(65+i),
      txt:htmlParaTextoPuro(b.children[1]?.innerHTML||'')}))
    .sort((a,b)=>a.letra.localeCompare(b.letra))
    .map(a=>`${a.letra}) ${a.txt}`);
  const btnCerto=document.querySelector('#fc-alts .alt-btn.correct')
    ||(currentCorrect!=null&&currentCorrect>=0?document.getElementById('alt-'+currentCorrect):null);
  const letraCorreta=btnCerto?(btnCerto.getAttribute('data-orig')||''):'';
  const textoCorreta=btnCerto?htmlParaTextoPuro(btnCerto.children[1]?.innerHTML||''):'';
  const respondida=document.getElementById('fc-ans').classList.contains('show');
  // Sem o cabeçalho "Gabarito: LETRA X" da tela — ele usa a letra embaralhada.
  let comentario='';
  if(respondida){const cl=document.getElementById('fc-ans-gabarito').cloneNode(true);
    cl.querySelectorAll('.gabarito-header').forEach(e=>e.remove());comentario=htmlParaTextoPuro(cl.innerHTML);}
  let partes=[];
  partes.push(`QUESTÃO${meta?' — '+meta:''}`);
  partes.push('');
  partes.push('ENUNCIADO:');
  partes.push(enunciado);
  if(alts.length){partes.push('');partes.push('ALTERNATIVAS:');partes.push(alts.join('\n'));}
  if(letraCorreta){partes.push('');partes.push(`GABARITO: LETRA ${letraCorreta}${textoCorreta?') '+textoCorreta:''}`
    +(q.conflito&&!q.conflitoDecidido?' (em conflito: o comentário do professor aponta outra letra — confira pelo comentário)':''));}
  if(comentario){partes.push('');partes.push('COMENTÁRIO DO PROFESSOR:');partes.push(comentario);}
  else{partes.push('');partes.push('(Comentário do professor não disponível — questão ainda não respondida nesta tela.)');}
  return partes.join('\n');
}
// Copia enunciado + comentário para a área de transferência, prontos para colar
// num prompt de IA (Claude, ChatGPT etc). Usa a Clipboard API moderna e cai para
// um textarea temporário + execCommand se o navegador não tiver a API (ex.: página
// aberta como arquivo local sem contexto seguro).
async function copiarTextoParaClipboard(texto){
  try{
    await navigator.clipboard.writeText(texto);
    return true;
  }catch(e){
    try{
      const ta=document.createElement('textarea');
      ta.value=texto;ta.style.position='fixed';ta.style.opacity='0';
      document.body.appendChild(ta);ta.focus();ta.select();
      const ok=document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    }catch(e2){return false;}
  }
}
// Abre uma conversa NOVA no Claude Desktop já com a skill de fundamentação e a
// questão inteira. A skill é chamada pelo comando de barra na primeira linha —
// é assim que ela é invocada no compositor.
//
// O que este link NÃO consegue fazer: escolher o modelo. A documentação do esquema
// claude:// lista só `q` (texto do prompt) para conversa nova — não há parâmetro de
// modelo nem de skill. Então o Sonnet tem de ser escolhido no seletor antes de
// enviar, ou definido como modelo padrão da conta. Prometer o contrário aqui seria
// mandar você estudar com o modelo errado sem perceber.
const SKILL_FUNDAMENTACAO='/fundamentacao-conceitual';
async function abrirFundamentacao(){
  const texto=montarTextoQuestaoAtual();
  if(!texto){notify('Nenhuma questão ativa','err');return;}
  const prompt=SKILL_FUNDAMENTACAO+'\n\n'
    +'Quero entender o CONCEITO por trás desta questão — o porquê, não o gabarito decorado.\n\n'
    +texto;
  await abrirNoClaude(prompt);
}
// Copia sempre antes de tentar o link: se o Claude Desktop não estiver instalado,
// o claude:// não faz nada e o texto já está na área de transferência para colar.
async function abrirNoClaude(prompt){
  let copiou=false;
  try{copiou=await copiarTextoParaClipboard(prompt);}catch(e){}
  const q=encodeURIComponent(prompt);
  if(q.length>14000)notify('Questão longa — se o Claude abrir vazio, cole com Ctrl+V (já está copiado)','err');
  else notify(copiou?'Copiado — abrindo o Claude numa conversa nova':'Abrindo o Claude numa conversa nova','ok');
  window.location.href=`claude://claude.ai/new?q=${q}`;
}
// ===== 💡 NA PRÁTICA =====
// Comentário prático gerado pela IA (mesma chave da Anthropic que gera questões),
// dentro do quadro da questão. Fica salvo na própria questão (q.pratico): na
// próxima revisão reaparece sem nova chamada — só gasta de novo em "Refazer".
// Usa o Haiku por padrão (o mais barato); se a conta não tiver esse modelo,
// cai para o modelo configurado no topo.
// Fontes, em ordem de peso: a questão + comentário do professor; até 3 questões
// do mesmo assunto no banco (com comentário); suas anotações do assunto.
// Regra dura: artigo, prazo, percentual e valor LEGAL só se estiverem nessas fontes.
const MODELO_PRATICA='claude-haiku-4-5-20251001';
let praticaGerando=false;
function praticaTextoPuro(s,lim){
  const t=String(s||'').replace(/<[^>]+>/g,' ').replace(/\*+/g,'').replace(/&nbsp;/g,' ').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
  return lim&&t.length>lim?t.slice(0,lim)+'…':t;
}
function praticaMaterialExtra(q){
  const mesmo=x=>x.id!==q.id&&!x.suspensa&&(x.materia||'').trim()===(q.materia||'').trim()&&(x.subtema||'').trim()===(q.subtema||'').trim()&&x.comentario;
  const irmas=questions.filter(mesmo).sort((a,b)=>((b.fonte==='tec')-(a.fonte==='tec'))).slice(0,3);
  const blocoIrmas=irmas.map((x,i)=>{
    const g=(x.alternativas||[])[x.gabarito]||x.gabTexto||'';
    return `[Questão relacionada ${i+1}]\n${praticaTextoPuro(x.questao,500)}\nResposta correta: ${praticaTextoPuro(g,200)}\nComentário: ${praticaTextoPuro(x.comentario,700)}`;
  }).join('\n\n');
  let notas=[];
  try{notas=(resumos||[]).filter(r=>r.questaoId===q.id||((r.materia||'')===(q.materia||'').trim()&&(r.subtema||'')===(q.subtema||'').trim())).slice(-3).map(r=>'- '+praticaTextoPuro(r.nota,300));}catch(e){}
  return {blocoIrmas,notas:notas.join('\n')};
}
function praticaPrompt(q){
  const base=montarTextoQuestaoAtual()||'';
  const {blocoIrmas,notas}=praticaMaterialExtra(q);
  return `MATERIAL PRINCIPAL (a questão que o candidato acabou de resolver):\n${base}\n\n`
   +(blocoIrmas?`MATERIAL DE APOIO (outras questões do mesmo assunto no banco dele):\n${blocoIrmas}\n\n`:'')
   +(notas?`ANOTAÇÕES DO CANDIDATO SOBRE O ASSUNTO:\n${notas}\n\n`:'')
   +`TAREFA: escreva o "Na prática" desta questão — comentários práticos que façam o candidato ENTENDER a regra cobrada, não decorar. Público: candidato a auditor fiscal (ISS Manaus, banca FCC).\n\n`
   +`REGRAS:\n`
   +`- A regra jurídica/técnica vem do material acima (principalmente do comentário do professor). É PROIBIDO citar artigo, lei, súmula, prazo, percentual, alíquota ou valor legal que não esteja no material.\n`
   +`- Valores de EXEMPLO (preço de um contrato, faturamento de uma empresa) podem ser inventados, desde que fique claro que são exemplo.\n`
   +`- Linguagem simples e concreta, como um professor explicando no quadro. Sem enrolação, sem repetir o enunciado.\n`
   +`- Se o material não sustentar algum bloco, deixe-o vazio ("" ou []). Não invente para preencher.\n`
   +`- Se o gabarito e o comentário não fecharem entre si, explique em "alerta"; senão deixe "".\n\n`
   +`BLOCOS:\n`
   +`- "cenario": uma situação real e concreta em que essa regra aparece (de preferência no trabalho de um fiscal ou na vida de um contribuinte), e o que a regra resolve ali. Até 450 caracteres.\n`
   +`- "passos": o raciocínio passo a passo aplicando a regra ao cenário (com conta, se o tema tiver cálculo). 2 a 5 itens curtos. [] se não couber.\n`
   +`- "contraste": "E se mudasse um detalhe?" — a situação vizinha em que a resposta MUDA, e por quê. Até 350 caracteres.\n`
   +`- "resumo": o RESUMO ESSENCIAL da questão, pontual: em 2 a 4 frases curtas, a regra que decide a questão, por que a alternativa correta está certa e o detalhe que derruba a alternativa mais tentadora. Marque com **negrito** os 2 a 4 termos-chave. Até 450 caracteres. É o que o candidato lê para relembrar a questão em 10 segundos.\n`
   +`- "conecta": 1 ou 2 assuntos vizinhos que costumam cair junto, e a ligação. Até 250 caracteres.\n`
   +`- "teste": uma pergunta rápida de verificação, aplicando a regra a um caso novo, {"pergunta":"...","resposta":"..."}.\n`
   +`- "alerta": "" ou o problema encontrado.\n\n`
   +`Entregue chamando a ferramenta registrar_pratica com esses campos.`;
}
// A resposta vem por "tool use" (ferramenta com esquema): a API devolve o objeto
// já estruturado, sem o modelo precisar escrever JSON à mão. Escrever JSON solto
// quebrava sempre que o texto tinha aspas dentro (ex.: "Identifying", SQL com 'x'):
// "Expected ',' or '}' after property value".
const PRATICA_TOOL={name:'registrar_pratica',description:'Registra o "Na prática" da questão.',
  input_schema:{type:'object',properties:{
    cenario:{type:'string'},passos:{type:'array',items:{type:'string'}},contraste:{type:'string'},
    resumo:{type:'string'},
    conecta:{type:'string'},
    teste:{type:'object',properties:{pergunta:{type:'string'},resposta:{type:'string'}},required:['pergunta','resposta']},
    alerta:{type:'string'}},
    required:['cenario','passos','contraste','resumo','conecta','teste','alerta']}};
function praticaParseTexto(txt){
  // plano B, só se a API não usar a ferramenta. Conserta aspas soltas dentro dos
  // textos: dentro de uma string, uma " só fecha a string se o próximo caractere
  // útil for , : } ] — senão ela é aspa do texto e vira \".
  const m=String(txt||'').match(/\{[\s\S]*\}/);if(!m)throw new Error('a IA não devolveu o formato esperado');
  try{return JSON.parse(m[0]);}catch(e){}
  const t=m[0];let out='',dentro=false;
  for(let k=0;k<t.length;k++){
    const c=t[k];
    if(dentro&&c==='\\'){out+=c+(t[k+1]||'');k++;continue;}
    if(c==='"'){
      if(!dentro){dentro=true;out+=c;continue;}
      // fecha só se vier  :  }  ]  fim  ou  vírgula seguida de nova string/objeto
      if(/^\s*(?:[:}\]]|$|,\s*["{\[])/.test(t.slice(k+1))){dentro=false;out+=c;}else out+='\\"';
      continue;
    }
    if(dentro&&c==='\n'){out+='\\n';continue;}
    out+=c;
  }
  return JSON.parse(out);
}
async function praticaChamarAPI(modelo,prompt){
  const res=await chamarClaude({model:modelo,max_tokens:2000,
      system:'Você é professor de cursinho para concursos fiscais. Escreve em português do Brasil, claro e concreto. Entregue o resultado chamando a ferramenta registrar_pratica.',
      tools:[PRATICA_TOOL],tool_choice:{type:'tool',name:'registrar_pratica'},
      messages:[{role:'user',content:prompt}]});
  if(!res.ok){const e=await res.json().catch(()=>({}));const err=new Error((e.error&&e.error.message)||('HTTP '+res.status));err.status=res.status;throw err;}
  const j=await res.json();
  const uso=(j.content||[]).find(b=>b.type==='tool_use');
  if(uso&&uso.input&&typeof uso.input==='object')return uso.input;
  return praticaParseTexto((j.content||[]).map(b=>b.text||'').join(''));
}
// Menu do botão 💡 Na prática. Se a questão já tem o comentário, mostra; se não tem,
// oferece três caminhos: gerar pela API (gasta crédito), copiar o pedido para uma IA
// externa (grátis, ex.: Claude.ai ou ChatGPT) ou colar a resposta que ela devolveu.
function praticaMenu(){
  const q=dueQueue[dueIdx];
  if(!q){notify('Nenhuma questão ativa','err');return;}
  if(!document.getElementById('fc-ans').classList.contains('show')){notify('Responda a questão primeiro — o "Na prática" usa o comentário do professor','err');return;}
  const real=questions.find(x=>x.id===q.id)||q;
  if(real.pratico){renderPratica(real,true);return;}
  const box=document.getElementById('fc-pratica');
  box.style.display='block';
  box.innerHTML=`<div class="pratica-box"><div class="pratica-tit" style="margin-bottom:8px">💡 Na prática — esta questão ainda não tem. Como quer gerar?</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="note-btn" onclick="praticaCopiarExterno(true)" title="Copia o pedido pronto e abre o Claude Desktop numa conversa nova">🚀 Copiar e abrir no Claude <small>(grátis)</small></button>
      <button class="note-btn" onclick="praticaCopiarExterno(false)" title="Copia o pedido pronto para colar em qualquer IA (Claude.ai, ChatGPT…)">📋 Só copiar o pedido <small>(grátis)</small></button>
      <button class="note-btn" onclick="abrirColarPratica()" title="Cole aqui o JSON que a IA externa devolveu">📥 Colar resposta</button>
      <button class="note-btn" onclick="gerarPratica(false)" title="Gera aqui mesmo, usando a chave da Anthropic">⚡ Gerar pela API <small>(gasta crédito)</small></button>
    </div>
    <div class="dash-cap" style="margin-top:8px">IA externa: copie o pedido, cole na IA, copie o JSON que ela devolver e clique em <b>📥 Colar resposta</b>. Fica salvo nesta questão, igual ao gerado pela API.</div></div>`;
}
async function praticaCopiarExterno(abrir){
  const q=dueQueue[dueIdx];if(!q)return;
  const real=questions.find(x=>x.id===q.id)||q;
  const formato={itens:[{id:real.id,impressao:impressaoQuestao(real),pratico:{cenario:'...',passos:['...'],contraste:'...',resumo:'...',conecta:'...',teste:{pergunta:'...',resposta:'...'},alerta:''}}]};
  const prompt=praticaPrompt(real).replace(/Entregue chamando a ferramenta registrar_pratica com esses campos\.\s*$/,'')
    +'FORMATO DA RESPOSTA: responda SOMENTE com o JSON abaixo, preenchido (sem texto antes ou depois). Copie "id" e "impressao" exatamente como estão.\n'
    +JSON.stringify(formato);
  if(abrir){await abrirNoClaude(prompt);}
  else{const ok=await copiarTextoParaClipboard(prompt);notify(ok?'📋 Pedido copiado — cole na IA e depois use 📥 Colar resposta':'Não consegui copiar','ok');}
}
async function gerarPratica(refazer){
  const q=dueQueue[dueIdx];
  if(!q){notify('Nenhuma questão ativa','err');return;}
  if(!document.getElementById('fc-ans').classList.contains('show')){notify('Responda a questão primeiro — o "Na prática" usa o comentário do professor','err');return;}
  const real=questions.find(x=>x.id===q.id)||q;
  if(real.pratico&&!refazer){renderPratica(real,true);return;}
  if(!getApiKey()){notify('Configure a chave da Anthropic no topo da tela (botão da chave) para usar o "Na prática"','err');return;}
  if(praticaGerando)return;
  praticaGerando=true;
  const box=document.getElementById('fc-pratica');
  box.style.display='block';
  box.innerHTML='<div class="pratica-box"><div class="pratica-carregando">💡 Gerando o "Na prática"… (alguns segundos)</div></div>';
  const prompt=praticaPrompt(real);
  let d,modelo=MODELO_PRATICA;
  try{
    try{d=await praticaChamarAPI(modelo,prompt);}
    catch(e){
      // modelo indisponível na conta → tenta o modelo configurado no topo
      if((e.status===404||e.status===400)&&/model/i.test(e.message)&&getModelo()!==MODELO_PRATICA){modelo=getModelo();d=await praticaChamarAPI(modelo,prompt);}
      else throw e;
    }
    real.pratico={...d,modelo,geradoEm:new Date().toISOString()};
    if(q!==real)q.pratico=real.pratico;
    save();
    renderPratica(real,true);
    notify('💡 "Na prática" gerado e salvo nesta questão','ok');
  }catch(e){
    const msg=e.status===401?(getChaveDireta()?'chave inválida (a chave sk-ant-... salva neste navegador foi recusada)':e.message):e.status===429?'limite de uso atingido, tente em instantes':/credit|balance|billing/i.test(e.message)?'sem créditos na conta da Anthropic':e.message;
    box.innerHTML=`<div class="pratica-box"><div class="pratica-erro">Não consegui gerar: ${esc(msg)}</div></div>`;
    notify('Falha no "Na prática": '+msg,'err');
  }finally{praticaGerando=false;}
}
function praticaFmt(s){return esc(String(s||'')).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');}
function renderPratica(q,aberto){
  const box=document.getElementById('fc-pratica');if(!box)return;
  const p=q&&q.pratico;
  if(!p){box.style.display='none';box.innerHTML='';return;}
  const partes=[];
  if(p.alerta)partes.push(`<div class="pratica-alerta">⚠️ ${praticaFmt(p.alerta)}</div>`);
  if(p.cenario)partes.push(`<div class="pratica-bloco"><div class="pratica-tit">🎯 Na vida real</div><div>${praticaFmt(p.cenario)}</div></div>`);
  if(Array.isArray(p.passos)&&p.passos.length)partes.push(`<div class="pratica-bloco"><div class="pratica-tit">🔢 Passo a passo</div><ol>${p.passos.map(x=>`<li>${praticaFmt(x)}</li>`).join('')}</ol></div>`);
  if(p.contraste)partes.push(`<div class="pratica-bloco"><div class="pratica-tit">⚖️ E se mudasse um detalhe?</div><div>${praticaFmt(p.contraste)}</div></div>`);
  if(p.resumo)partes.push(`<div class="pratica-bloco pratica-resumo"><div class="pratica-tit">📌 Resumo essencial</div><div>${praticaFmt(p.resumo)}</div></div>`);
  if(Array.isArray(p.distorcoes)&&p.distorcoes.length)partes.push(`<div class="pratica-bloco"><div class="pratica-tit">🪤 Como a banca distorce</div><ul>${p.distorcoes.map(x=>`<li><span class="pratica-errado">“${praticaFmt(x.banca)}”</span><br>→ ${praticaFmt(x.certo)}</li>`).join('')}</ul></div>`);
  if(p.conecta)partes.push(`<div class="pratica-bloco"><div class="pratica-tit">🔗 Conecta com</div><div>${praticaFmt(p.conecta)}</div></div>`);
  if(p.teste&&p.teste.pergunta)partes.push(`<div class="pratica-bloco"><div class="pratica-tit">✅ Teste rápido</div><div>${praticaFmt(p.teste.pergunta)}</div><details class="pratica-resp"><summary>Ver resposta</summary><div>${praticaFmt(p.teste.resposta)}</div></details></div>`);
  const quando=p.geradoEm?new Date(p.geradoEm).toLocaleDateString('pt-BR'):'';
  box.style.display='block';
  box.innerHTML=`<details class="pratica-box"${aberto?' open':''}><summary>💡 Na prática <small>salvo${quando?' em '+quando:''}</small></summary>`
    +partes.join('')
    +`<div class="pratica-rodape"><span>Gerado por IA a partir do comentário do professor — confira números com a lei.</span><button class="note-btn" onclick="gerarPratica(true)">↻ Refazer</button></div></details>`;
}

// ===== 💡 NA PRÁTICA EM LOTE (gerado fora do site) =====
// Exporta as próximas N questões da fila sem "Na prática", com o MESMO material
// que o botão usa; o Claude gera fora do site e devolve um arquivo que é importado aqui.
// Sincronização: cada item leva o id da questão E uma impressão digital do texto
// (enunciado + alternativas + gabarito). Na importação, só grava se os DOIS baterem —
// questão que mudou no meio do caminho (tabela corrigida, gabarito trocado) é recusada.
function impressaoQuestao(q){
  const norm=x=>String(x||'').replace(/<[^>]+>/g,' ').replace(/[*_​]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
  const s=norm(q.questao)+'¦'+(q.alternativas||[]).map(norm).join('¦')+'¦'+indiceGabarito(q);
  let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0;}
  return h.toString(16).padStart(8,'0')+'-'+s.length.toString(36);
}
// Mesmo formato do texto que o botão manda, mas montado da questão (sem depender da tela)
function montarTextoDeQuestao(q){
  const L=i=>String.fromCharCode(65+i);
  const meta=[q.materia,q.banca,q.subtema].filter(Boolean).join(' · ');
  const alts=(q.alternativas||[]).map((a,i)=>`${L(i)}) ${praticaTextoPuro(a).replace(/^\s*[A-Ea-e]\)\s*/,'')}`);
  const g=indiceGabarito(q);
  const partes=[`QUESTÃO${meta?' — '+meta:''}`,'','ENUNCIADO:',praticaTextoPuro(q.questao)];
  if(alts.length)partes.push('','ALTERNATIVAS:',alts.join('\n'));
  if(alts.length&&g!=null&&g>=0)partes.push('',`GABARITO: LETRA ${L(g)}) ${praticaTextoPuro((q.alternativas||[])[g])}`
    +(q.conflito&&!q.conflitoDecidido?' (em conflito: o comentário do professor aponta outra letra — confira pelo comentário)':''));
  partes.push('','COMENTÁRIO DO PROFESSOR:',praticaTextoPuro(q.comentario,7000));
  return partes.join('\n');
}
// A ordem é a da fila: primeiro a sessão de hoje (se estiver aberta), depois as
// revisões por data de vencimento, depois as inéditas de banca na ordem do déficit.
// A ordem é a da fila REAL do app: primeiro exatamente as questões que a tela de
// Estudar vai servir hoje (mesmo cálculo: limite do dia, irmãs, cota de inéditas,
// reserva da Prova I, cobertura) — calculado em silêncio, sem mexer na sessão aberta;
// depois o restante do que já venceu, na prioridade de revisão (erros abertos
// primeiro) e as inéditas na ordem do déficit; por fim o que vence nos próximos dias.
async function filaDeHojeSilenciosa(){
  const guarda={dueQueue,dueIdx,sessOk,sessErr,showCard:window.showCard,updateSessBar:window.updateSessBar,notify:window.notify};
  let fila=[];
  try{
    window.showCard=()=>{};window.updateSessBar=()=>{};window.notify=()=>{};
    await initStudy();
    fila=(dueQueue||[]).slice();
  }catch(e){fila=[];}
  finally{
    window.showCard=guarda.showCard;window.updateSessBar=guarda.updateSessBar;window.notify=guarda.notify;
    dueQueue=guarda.dueQueue;dueIdx=guarda.dueIdx;sessOk=guarda.sessOk;sessErr=guarda.sessErr;
  }
  return fila;
}
async function filaParaLotePratica(){
  const ok=q=>!q.suspensa&&q.comentario&&!q.pratico;
  const vistos=new Set(),saida=[];
  const add=q=>{if(q&&ok(q)&&!vistos.has(q.id)){vistos.add(q.id);saida.push(q);}};
  const porId=new Map(questions.map(q=>[q.id,q]));
  // 1) a sessão aberta (o que ainda falta dela) e 2) a fila de hoje calculada do zero
  (dueQueue||[]).slice(dueIdx||0).forEach(x=>add(porId.get(x.id)));
  (await filaDeHojeSilenciosa()).forEach(x=>add(porId.get(x.id)));
  // 2b) a fila de um dia novo, calculada do zero (sem descontar o que já respondeu hoje): é o que o app vai
  //     servir em seguida, com as inéditas da cota. Sem isso, depois de bater a meta do dia o lote saía só com
  //     revisões antigas e quase nenhuma das questões que aparecem amanhã.
  {const salvoRH=window.respondidasHoje; window.respondidasHoje=()=>0; try{(await filaDeHojeSilenciosa()).forEach(x=>add(porId.get(x.id)));}catch(e){}finally{window.respondidasHoje=salvoRH;}}
  // 3) o que já venceu e não coube hoje, na mesma prioridade do app
  const ehNova=q=>q.fonte==='tec'&&!(q.acertos||0)&&!(q.erros||0)&&!(q.reps||0);
  const vencidas=questions.filter(q=>ok(q)&&!vistos.has(q.id)&&naSessao(q));
  let statsMap=null;try{statsMap=estatisticasPorAssunto();}catch(e){}
  let rev=vencidas.filter(q=>!ehNova(q)),nov=vencidas.filter(ehNova);
  try{rev=ordenarRevisoes(rev,statsMap);}catch(e){}
  try{nov=ordenarNovasPorDeficit(nov,statsComTetoFatia(statsMap,TETO_FATIA_NOVAS));}catch(e){}
  // revisões e inéditas na proporção da cota do dia (antes: todas as revisões primeiro, e as inéditas — ~40% do que aparece — nunca entravam no lote)
  {const cotaN=(schedCfg().cotaNovas??0.40); let iR=0,iN=0; while(iR<rev.length||iN<nov.length){if(iN<nov.length&&(iR>=rev.length||iN<Math.round((iR+iN+1)*cotaN)))add(nov[iN++]); else add(rev[iR++]);}}
  // 4) o que vence nos próximos dias
  questions.filter(q=>ok(q)&&!vistos.has(q.id)&&!q.suspensa).sort((a,b)=>String(a.nextDue||'9').localeCompare(String(b.nextDue||'9'))).forEach(add);
  return saida;
}
// ---- Controle de lotes em andamento ----
// Cada exportação vira um "lote pendente" guardado aqui. A próxima exportação pula
// automaticamente as questões que já estão num lote pendente — por isso não existe
// mais "posição": exportar duas vezes seguidas (uma para o Claude, outra para o
// ChatGPT) já dá questões diferentes. Ao importar, as questões gravadas saem do lote;
// lote que esvazia some. Lote perdido (arquivo que nunca voltou) se libera no botão.
const LOTEPR_KEY='questia_pratica_lotes';
function lerLotesPratica(){try{const v=JSON.parse(localStorage.getItem(LOTEPR_KEY)||'[]');return Array.isArray(v)?v:[];}catch(e){return[];}}
function salvarLotesPratica(l){try{localStorage.setItem(LOTEPR_KEY,JSON.stringify(l));}catch(e){}}
function idsPendentesPratica(){const s=new Set();lerLotesPratica().forEach(l=>(l.ids||[]).forEach(id=>s.add(String(id))));return s;}
function liberarLotePratica(nome){
  if(!confirm(`Liberar o lote "${nome}"?\n\nAs questões dele voltam para a fila de exportação. Use isso só se o arquivo de resposta não vai mais voltar.`))return;
  salvarLotesPratica(lerLotesPratica().filter(l=>l.nome!==nome));renderStatusLotePratica();
}
function renderStatusLotePratica(){
  const el=document.getElementById('lotepr-status');if(!el)return;
  const porId=new Map(questions.map(q=>[String(q.id),q]));
  const elegiveis=questions.filter(q=>!q.suspensa&&q.comentario);
  const com=elegiveis.filter(q=>q.pratico).length;
  // limpa dos lotes o que já ganhou "Na prática" (ex.: gerado pelo botão na própria questão)
  const lotes=lerLotesPratica().map(l=>({...l,ids:(l.ids||[]).filter(id=>{const q=porId.get(String(id));return q&&!q.pratico;})})).filter(l=>l.ids.length);
  salvarLotesPratica(lotes);
  const pend=lotes.reduce((a,l)=>a+l.ids.length,0);
  const faltam=elegiveis.length-com-pend;
  const dias=d=>{const n=Math.floor((Date.now()-new Date(d).getTime())/86400000);return n<=0?'hoje':n===1?'ontem':`há ${n} dias`;};
  el.innerHTML=`<div class="lotepr-nums"><div><b>${com}</b><span>já têm "Na prática"</span></div><div><b>${pend}</b><span>aguardando retorno</span></div><div><b>${Math.max(0,faltam)}</b><span>ainda sem</span></div></div>`
    +(lotes.length?`<div class="lotepr-lotes">${lotes.map(l=>`<div class="lotepr-lote"><span><b>${esc(l.nome)}</b> · ${l.ids.length} questões · exportado ${dias(l.criadoEm)}${l.destino?' · '+esc(l.destino):''}</span><button class="btn btn-ghost btn-sm" onclick="liberarLotePratica('${esc(l.nome).replace(/'/g,"\\'")}')">liberar</button></div>`).join('')}</div>`
      :`<div class="lotepr-vazio">Nenhum lote aguardando retorno. É só clicar em <b>📤 Exportar próximo lote</b>.</div>`);
}
async function exportarLotePratica(){
  const n=Math.max(1,Math.min(300,+(document.getElementById('lotepr-n')||{}).value||50));
  const pend=idsPendentesPratica();
  const fila=(await filaParaLotePratica()).filter(q=>!pend.has(String(q.id)));
  const alvo=fila.slice(0,n);
  if(!alvo.length){notify('Nada para exportar: tudo já tem "Na prática" ou está num lote aguardando retorno','ok');return;}
  const lotes=lerLotesPratica();
  const seq=(+(localStorage.getItem('questia_pratica_seq')||0))+1;try{localStorage.setItem('questia_pratica_seq',String(seq));}catch(e){}
  const nome=`Lote ${seq}`;
  lotes.push({nome,criadoEm:new Date().toISOString(),ids:alvo.map(q=>q.id)});salvarLotesPratica(lotes);
  const itens=alvo.map(q=>{const {blocoIrmas,notas}=praticaMaterialExtra(q);
    return {id:q.id,impressao:impressaoQuestao(q),materia:q.materia||'',subtema:q.subtema||'',
      material:montarTextoDeQuestao(q),apoio:blocoIrmas||'',anotacoes:notas||''};});
  const payload={tipo:'questia-pratica-pedido',versao:2,lote:nome,geradoEm:new Date().toISOString(),
    total:itens.length,instrucoes:'mesmas regras e blocos do botão 💡 Na prática',itens};
  const blob=new Blob([JSON.stringify(payload,null,1)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download=`questia-pratica-pedido-lote${seq}-${itens.length}q-${today()}.json`;document.body.appendChild(a);a.click();a.remove();
  document.getElementById('lotepr-info').textContent=`📤 ${nome} exportado com ${itens.length} questões. Ele fica "aguardando retorno" até você importar a resposta — a próxima exportação já pula essas questões.`;
  renderStatusLotePratica();
  notify(`📤 ${nome}: ${itens.length} questões exportadas`,'ok');
}
// Aceita o arquivo OU o texto colado da resposta de qualquer IA: tira cercas ```json,
// texto antes/depois e aceita tanto {itens:[...]} quanto a lista pura [...].
function lerRespostaPratica(txt){
  let t=String(txt||'').replace(/```(?:json)?/gi,'').trim();
  const i1=t.search(/[\[{]/);if(i1<0)throw new Error('sem JSON');
  const fecha=t[i1]==='['?']':'}';t=t.slice(i1,t.lastIndexOf(fecha)+1);
  try{return JSON.parse(t);}catch(e){return praticaParseTexto(t);}
}
function abrirColarPratica(){document.getElementById('colarpr-modal').classList.add('open');setTimeout(()=>document.getElementById('colarpr-txt').focus(),50);}
function fecharColarPratica(){document.getElementById('colarpr-modal').classList.remove('open');}
function importarColadoPratica(){
  const t=document.getElementById('colarpr-txt').value;
  if(!t.trim()){notify('Cole a resposta da IA primeiro','err');return;}
  let d;try{d=lerRespostaPratica(t);}catch(e){notify('Não reconheci o JSON colado: '+e.message,'err');return;}
  fecharColarPratica();aplicarLotePratica(d);document.getElementById('colarpr-txt').value='';
}
function importarLotePratica(event){
  const input=event.target;const file=input.files&&input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    try{input.value='';}catch(_){}
    let d;try{d=lerRespostaPratica(e.target.result);}catch(err){notify('JSON inválido','err');return;}
    aplicarLotePratica(d);
  };
  reader.readAsText(file);
}
function aplicarLotePratica(d){
  {
    const itens=d.itens||(Array.isArray(d)?d:null);
    if(!Array.isArray(itens)||!itens.length){notify('Arquivo sem itens','err');return;}
    const sobrescrever=!!(document.getElementById('lotepr-sobre')||{}).checked;
    const porId=new Map(questions.map(q=>[q.id,q]));
    const bom=p=>p&&typeof p==='object'&&typeof p.cenario==='string'&&(typeof p.resumo==='string'||Array.isArray(p.distorcoes))&&p.teste&&typeof p.teste==='object';
    const aplicar=[],rec={semQuestao:[],textoMudou:[],jaTinha:[],formato:[]};
    itens.forEach(it=>{
      const q=porId.get(it.id)??porId.get(Number(it.id));
      if(!q){rec.semQuestao.push(it.id);return;}
      if(!it.impressao||it.impressao!==impressaoQuestao(q)){rec.textoMudou.push(it.id);return;}
      if(!bom(it.pratico)){rec.formato.push(it.id);return;}
      if(q.pratico&&!sobrescrever){rec.jaTinha.push(it.id);return;}
      aplicar.push({q,p:it.pratico});
    });
    const lin=[`• ${aplicar.length} recebem o "Na prática"`];
    if(rec.textoMudou.length)lin.push(`• ${rec.textoMudou.length} recusadas: o texto/gabarito mudou desde a exportação (${rec.textoMudou.slice(0,8).join(', ')}${rec.textoMudou.length>8?'…':''})`);
    if(rec.semQuestao.length)lin.push(`• ${rec.semQuestao.length} recusadas: questão não está no banco`);
    if(rec.formato.length)lin.push(`• ${rec.formato.length} recusadas: formato incompleto (${rec.formato.slice(0,8).join(', ')})`);
    if(rec.jaTinha.length)lin.push(`• ${rec.jaTinha.length} ignoradas: já tinham "Na prática" (marque "sobrescrever" para trocar)`);
    if(!aplicar.length){alert('Nada a gravar:\n\n'+lin.join('\n'));return;}
    if(!confirm('Importar "Na prática" em lote?\n\n'+lin.join('\n')+'\n\nSó o "Na prática" é gravado — enunciado, gabarito, agendamento, acertos e erros não são tocados.'))return;
    const agora=new Date().toISOString();
    aplicar.forEach(({q,p})=>{q.pratico={cenario:p.cenario||'',passos:Array.isArray(p.passos)?p.passos:[],contraste:p.contraste||'',
      resumo:typeof p.resumo==='string'?p.resumo:'',distorcoes:(p.distorcoes||[]).filter(x=>x&&x.banca&&x.certo),conecta:p.conecta||'',
      teste:{pergunta:(p.teste||{}).pergunta||'',resposta:(p.teste||{}).resposta||''},alerta:p.alerta||'',
      modelo:p.modelo||d.modelo||'Claude (lote externo)',geradoEm:agora,origem:'lote'};});
    save();
    {const saiu=new Set([...aplicar.map(o=>String(o.q.id)),...rec.jaTinha.map(String)]);
     salvarLotesPratica(lerLotesPratica().map(l=>({...l,ids:(l.ids||[]).filter(id=>!saiu.has(String(id)))})).filter(l=>l.ids.length));
     renderStatusLotePratica();}
    document.getElementById('lotepr-info').textContent=`📥 ${aplicar.length} questões receberam o "Na prática".`+(rec.textoMudou.length?` ${rec.textoMudou.length} recusadas por texto alterado.`:'');
    notify(`📥 "Na prática" gravado em ${aplicar.length} questões`,'ok');
    {const atual=dueQueue[dueIdx],achou=atual&&aplicar.find(o=>o.q.id===atual.id);if(achou)renderPratica(achou.q,true);}
  }
}

// Copia e cola: só o conteúdo da questão, sem skill nem instrução nenhuma, e sem
// abrir app — para colar no ChatGPT, Gemini ou onde for.
async function copiaEColaQuestao(){
  const texto=montarTextoQuestaoAtual();
  if(!texto){notify('Nenhuma questão ativa para copiar','err');return;}
  const ok=await copiarTextoParaClipboard(texto);
  const semComent=!document.getElementById('fc-ans').classList.contains('show');
  notify(ok?(semComent?'📄 Copiado — sem o comentário do professor (responda a questão antes para ele entrar)':'📄 Enunciado + comentário copiados — é só colar'):'Não consegui copiar','ok');
}
async function copiarQuestaoAtual(){
  const texto=montarTextoQuestaoAtual();
  if(!texto){notify('Nenhuma questão ativa para copiar','err');return;}
  await dispararLoteParaClaude([texto]);
}
// ===== LOTE PARA O CLAUDE =====
// Em vez de abrir uma conversa nova a cada questão (gastando uma conversa/tokens
// de contexto por questão), as questões vão se acumulando num "lote" salvo no
// localStorage. Quando o lote chega a 10 questões — ou fica perto do limite de
// ~14000 caracteres que o link claude:// aceita no parâmetro q, o que vier primeiro —
// o lote inteiro é despachado numa única conversa nova e reinicia do zero.
const CLAUDE_LOTE_KEY='qia_claude_lote';
const CLAUDE_LOTE_MAX=10;
const CLAUDE_LOTE_CHAR_BUDGET=11000; // margem de segurança abaixo do limite de ~14000 do link claude://
function lerLoteClaude(){
  try{const v=JSON.parse(localStorage.getItem(CLAUDE_LOTE_KEY)||'[]');return Array.isArray(v)?v:[];}
  catch(e){return[];}
}
function salvarLoteClaude(lote){
  try{localStorage.setItem(CLAUDE_LOTE_KEY,JSON.stringify(lote));}catch(e){}
}
function tamanhoCaracteresLote(lote){return lote.reduce((s,t)=>s+t.length,0);}
function atualizarBadgeLoteClaude(){
  const btn=document.getElementById('claude-lote-btn');
  if(!btn)return;
  const n=lerLoteClaude().length;
  btn.textContent=`➕ Lote Claude (${n}/${CLAUDE_LOTE_MAX})`;
}
// Copia o lote e tenta abrir o Claude Desktop já com o prompt preenchido, usando
// o esquema de link claude://. Isso só funciona se o app Claude Desktop estiver
// instalado no computador — no site claude.ai (navegador) e no celular esse link
// não tem efeito. Por isso o conteúdo é sempre copiado antes: mesmo que o link não
// funcione, o texto já está na área de transferência para colar manualmente numa
// conversa nova.
// Formato da skill "questoes-comentadas" (a versão didática). O comando de barra na
// 1ª linha chama a skill quando ela está instalada na conta; o resumo do formato vem
// logo abaixo para a resposta sair no mesmo padrão mesmo se a skill não carregar —
// e fica curto de propósito, porque o link claude:// só leva ~14 mil caracteres.
const SKILL_COMENTADA='/questoes-comentadas';
const INSTRUCAO_COMENTADA=[
 'Responda cada questão direto aqui no chat, no formato didático e ENXUTO da skill questoes-comentadas:',
 '1. 📖 O que a questão cobra — 1-2 linhas com o núcleo testado.',
 '2. 📌 Gabarito — a letra correta JUNTO com o texto integral dessa alternativa.',
 '3. 🔍 Análise das alternativas — para CADA uma: primeiro a alternativa explícita, INTEIRA EM NEGRITO (🟢/🔴 **letra) texto integral**, como está na questão, sem parafrasear); depois, na linha de baixo, o comentário em 1-3 linhas como CITAÇÃO em itálico (linha começando com "> → " e o texto entre *asteriscos*), para ficar num tom diferente da alternativa. Ex.:\n   🔴 **A) texto integral da alternativa**\n   > → *por que está errada*\n   Erro que se repete pode ganhar uma observação única DEPOIS da lista, mas cada alternativa continua listada.',
 '4. 🧠 Lógica de fundo — só quando agregar: o porquê da regra (2-4 linhas ou tabela curta), para não depender de decoreba.',
 '5. 📌 Resumo essencial — sempre: a regra central (1-3 linhas), a pegadinha mais comum do tema e, se couber, uma regra de ouro/mnemônico.',
 'Use o comentário do professor como base, mas reescreva com suas palavras. CONFIRA contas e lógica antes de responder: se o gabarito ou o comentário não fecharem, diga isso claramente, mostre o raciocínio certo e sinalize a questão como possivelmente malformada — não force a explicação.',
 'As alternativas estão na ordem original e o GABARITO indicado é o oficial; as letras citadas no comentário do professor são essas mesmas.',
 'NÃO gere PDF, arquivo ou artifact, NÃO junte as questões num resumo único, NÃO pergunte nada antes — comece pela primeira questão. Sem saudações nem "espero ter ajudado".'
].join('\n');
async function dispararLoteParaClaude(lote){
  if(!lote.length)return;
  // Instrução bem explícita e direta: sem isso, o Claude às vezes fica em dúvida
  // entre skills parecidas (a que gera PDF de revisão, a que consolida guias etc.)
  // e responde perguntando o que você quer, em vez de já aplicar a skill certa.
  const instrucaoBase=SKILL_COMENTADA+'\n\n'+INSTRUCAO_COMENTADA+'\n\n';
  const cabecalho=instrucaoBase+(lote.length>1
    ?`Seguem ${lote.length} questões de concurso, cada uma com enunciado, alternativas, gabarito e comentário do professor. Responda a cada uma separadamente, na ordem, com a estrutura completa para cada uma.\n\n`
    :'Segue a questão de concurso, com enunciado, alternativas, gabarito e comentário do professor:\n\n');
  const corpo=lote.map((t,i)=>lote.length>1?`### Questão ${i+1}\n\n${t}`:t).join('\n\n---\n\n');
  const prompt=cabecalho+corpo;
  const ok=await copiarTextoParaClipboard(prompt);
  notify(ok?`📋 Lote de ${lote.length} questão(ões) copiado! Tentando abrir o Claude Desktop…`:`Copiar falhou — tentando abrir o Claude Desktop mesmo assim…`,'ok');
  const q=encodeURIComponent(prompt.slice(0,13500)); // limite do link claude://
  window.location.href=`claude://claude.ai/new?q=${q}`;
}
// Adiciona a questão atual ao lote. Se isso estourar 10 questões OU o orçamento de
// caracteres, primeiro despacha o lote como estava (sem a nova questão) e só então
// começa um lote novo já contendo ela.
async function adicionarAoLoteClaude(){
  const texto=montarTextoQuestaoAtual();
  if(!texto){notify('Nenhuma questão ativa para adicionar ao lote','err');return;}
  let lote=lerLoteClaude();
  const estourou=lote.length>0&&(lote.length>=CLAUDE_LOTE_MAX||tamanhoCaracteresLote(lote)+texto.length>CLAUDE_LOTE_CHAR_BUDGET);
  if(estourou){
    const loteAnterior=lote;
    salvarLoteClaude([]);
    await dispararLoteParaClaude(loteAnterior);
    lote=[];
  }
  lote.push(texto);
  salvarLoteClaude(lote);
  atualizarBadgeLoteClaude();
  if(lote.length>=CLAUDE_LOTE_MAX||tamanhoCaracteresLote(lote)>=CLAUDE_LOTE_CHAR_BUDGET){
    // Essa questão sozinha já fecha o lote — despacha na hora, sem esperar a próxima.
    salvarLoteClaude([]);
    await dispararLoteParaClaude(lote);
    atualizarBadgeLoteClaude();
  }else if(!estourou){
    notify(`➕ Adicionada ao lote (${lote.length}/${CLAUDE_LOTE_MAX})`,'ok');
  }
}
// Envia manualmente o lote atual (mesmo incompleto) e zera o contador.
async function enviarLoteClaudeAgora(){
  const lote=lerLoteClaude();
  if(!lote.length){notify('O lote do Claude está vazio','err');return;}
  salvarLoteClaude([]);
  await dispararLoteParaClaude(lote);
  atualizarBadgeLoteClaude();
}
// Abre a caixinha de anotação para a questão que está na tela do estudo agora.
// A caixa sempre abre EM BRANCO — nada é pré-preenchido a partir do comentário.
function abrirAnotacao(){
  const q=dueQueue[dueIdx];
  if(!q){notify('Nenhuma questão ativa para anotar','err');return;}
  notaAlvoQuestao=q;
  const meta=[q.materia,q.subtema].filter(Boolean).join(' · ')||'Sem matéria/subtema';
  document.getElementById('anot-meta').textContent=meta;
  document.getElementById('anot-nota').value='';
  document.getElementById('anotacao-modal').classList.add('open');
  setTimeout(()=>document.getElementById('anot-nota').focus(),60);
}
function fecharAnotacao(){document.getElementById('anotacao-modal').classList.remove('open');notaAlvoQuestao=null;}
function enviarAnotacao(){
  const q=notaAlvoQuestao;
  if(!q){fecharAnotacao();return;}
  const nota=document.getElementById('anot-nota').value.trim();
  if(!nota){notify('Escreva algo antes de enviar','err');return;}
  resumos.push({
    id:Date.now()+Math.random(),
    materia:(q.materia||'Sem matéria').trim(),
    subtema:(q.subtema||'Sem subtema').trim(),
    nota,
    questaoId:q.id,
    questaoTrecho:String(q.questao||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,180),
    data:new Date().toISOString()
  });
  saveResumos();
  fecharAnotacao();
  notify('📝 Anotado no resumo!','ok');
  if(document.getElementById('page-resumos').classList.contains('active'))renderResumos();
}
function deleteResumo(id){
  if(!confirm('Excluir esta anotação do resumo?'))return;
  resumos=resumos.filter(r=>r.id!==id);
  saveResumos();renderResumos();
  notify('Anotação excluída','err');
}
function popularResumoMaterias(){
  const sel=document.getElementById('f-resumo-materia');if(!sel)return;
  const atual=sel.value;
  const materias=[...new Set(resumos.map(r=>r.materia))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  sel.innerHTML='<option value="">Todas as matérias</option>'+materias.map(m=>`<option value="${esc(m)}">${esc(m)}</option>`).join('');
  if(materias.includes(atual))sel.value=atual;
}
function renderResumos(){
  popularResumoMaterias();
  const filtroMateria=document.getElementById('f-resumo-materia')?.value||'';
  const busca=(document.getElementById('f-resumo-busca')?.value||'').trim().toLowerCase();
  const wrap=document.getElementById('resumos-list');
  document.getElementById('resumo-total').textContent=resumos.length;
  let lista=resumos.slice();
  if(filtroMateria)lista=lista.filter(r=>r.materia===filtroMateria);
  if(busca)lista=lista.filter(r=>(r.nota+' '+r.subtema).toLowerCase().includes(busca));
  if(!lista.length){
    wrap.innerHTML=`<div class="empty-state"><div class="empty-icon">🗒️</div><div class="empty-title">Nenhuma anotação ainda</div>
      <div class="empty-sub">Durante o estudo, depois de responder, clique em <strong>📝 Anotar</strong> junto do comentário para começar a construir seu resumo.</div></div>`;
    return;
  }
  // Agrupa matéria → subtema, preservando a ordem de chegada dentro de cada subtema
  const porMateria=new Map();
  lista.forEach(r=>{
    if(!porMateria.has(r.materia))porMateria.set(r.materia,new Map());
    const porSub=porMateria.get(r.materia);
    if(!porSub.has(r.subtema))porSub.set(r.subtema,[]);
    porSub.get(r.subtema).push(r);
  });
  const materiasOrdenadas=[...porMateria.keys()].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  wrap.innerHTML=materiasOrdenadas.map(mat=>{
    const porSub=porMateria.get(mat);
    const subsOrdenados=[...porSub.keys()].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    const totalMat=[...porSub.values()].reduce((n,arr)=>n+arr.length,0);
    return `<div class="resumo-materia">
      <div class="resumo-materia-head">${esc(mat)} <span class="resumo-count">${totalMat}</span></div>
      ${subsOrdenados.map(sub=>{
        const itens=porSub.get(sub);
        return `<div class="resumo-subtema">
          <div class="resumo-subtema-head">${esc(sub)} <span class="resumo-count">${itens.length}</span></div>
          ${itens.map(r=>`<div class="resumo-item">
            ${r.nota?`<div class="resumo-nota">${esc(r.nota)}</div>`:''}
            <div class="resumo-foot">
              <span class="resumo-data">${new Date(r.data).toLocaleDateString('pt-BR')}${r.questaoTrecho?' · '+esc(r.questaoTrecho.slice(0,70))+(r.questaoTrecho.length>70?'…':''):''}</span>
              <button class="resumo-del" onclick="deleteResumo(${JSON.stringify(r.id)})" title="Excluir">🗑</button>
            </div>
          </div>`).join('')}
        </div>`;
      }).join('')}
    </div>`;
  }).join('');
}
function exportResumos(){
  if(!resumos.length){notify('Nenhuma anotação para exportar','err');return;}
  const porMateria=new Map();
  resumos.forEach(r=>{
    if(!porMateria.has(r.materia))porMateria.set(r.materia,new Map());
    const porSub=porMateria.get(r.materia);
    if(!porSub.has(r.subtema))porSub.set(r.subtema,[]);
    porSub.get(r.subtema).push(r);
  });
  let md=`# Resumo — QuestIA\n\nExportado em ${new Date().toLocaleString('pt-BR')}\n\n`;
  [...porMateria.keys()].sort((a,b)=>a.localeCompare(b,'pt-BR')).forEach(mat=>{
    md+=`\n## ${mat}\n`;
    const porSub=porMateria.get(mat);
    [...porSub.keys()].sort((a,b)=>a.localeCompare(b,'pt-BR')).forEach(sub=>{
      md+=`\n### ${sub}\n`;
      porSub.get(sub).forEach(r=>{
        if(r.nota)md+=`\n- **${r.nota}**`;
        md+='\n';
      });
    });
  });
  const blob=new Blob([md],{type:'text/markdown'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  const dateStr=new Date().toLocaleDateString('pt-BR').replace(/\//g,'-');
  a.href=url;a.download=`questia-resumo-${dateStr}.md`;a.click();URL.revokeObjectURL(url);
  notify('✓ Resumo exportado em Markdown!','ok');
}
// No TEC, a correção de um item errado mostra o trecho que estava ERRADO riscado (vermelho)
// e o trecho que o CORRIGE ao lado (azul, negrito). O app só desenha o risco quando o texto
// importado traz ~~trecho~~. Quando o coletor perde essa marca e entrega os dois trechos como
// negrito comum — "**mantida a responsabilidade** **excluída a responsabilidade**" —, o
// risco some e os dois ficam iguais na tela, sem dar para saber qual saiu e qual entrou.
// Reforço: dentro do parágrafo que segue "Corrigindo o item", dois negritos colados
// (só espaço entre eles) formam o par "saiu → entrou"; o primeiro é riscado. Um negrito
// sozinho (acréscimo puro, como ", hipótese em que…") continua como está. Se o texto já
// veio com ~~ ~~ funcionando, nada é mexido.
function riscarTrechoSubstituido(html){
  const m=/Corrigindo\s+(?:o\s+item|a\s+assertiva|a\s+afirma\w+|a\s+alternativa)[^<]{0,10}(?:<\/strong>)?/i.exec(html);
  if(!m)return html;
  const ini=m.index+m[0].length;
  const partes=html.slice(ini).split('<br><br>');            // parágrafos depois do "Corrigindo o item:"
  const vazio=p=>!p.replace(/<[^>]*>|&nbsp;|\s/g,'');
  const ehLista=p=>/^(?:\s|&nbsp;|<[^>]+>)*[-\u2013\u2022]/.test(p);
  // Trata o primeiro parágrafo com texto (a correção em si) e, depois dele, só os que
  // continuam a lista com "-". Para no primeiro parágrafo comum: a explicação que vem
  // depois da correção não é lugar de par "saiu → entrou".
  let jaTratou=false;
  for(let i=0;i<partes.length;i++){
    const p=partes[i];
    if(p.includes('md-sep'))break;
    if(vazio(p))continue;
    if(jaTratou&&!ehLista(p))break;
    jaTratou=true;
    if(p.includes('md-riscado'))continue;                    // o ~~ já funcionou aqui
    partes[i]=p.replace(/<strong>([^<]{1,400})<\/strong>(?:\s|&nbsp;)*<strong>([^<]{1,400})<\/strong>/g,
      '<s class="md-riscado">$1</s> <strong>$2</strong>');
  }
  return html.slice(0,ini)+partes.join('<br><br>');
}
// Marca, no texto do professor, cada abertura de alternativa ("a)", "B)") que
// começa um parágrafo. Vira âncora clicável (para o salto vindo do cartão) e
// ganha destaque: antes era cinza igual ao resto e obrigava a varrer o comentário
// inteiro com o olho para achar a letra que interessava.
function marcarLetrasNoComentario(html){
  // Só a PRIMEIRA aparição de cada letra recebe id (âncora do salto); as demais
  // ficam apenas destacadas. Sem isso o documento teria ids repetidos e o
  // getElementById cairia sempre na primeira, que nem sempre é a que interessa.
  const vistas=new Set();
  const env=(letra,txt)=>{
    const L=letra.toUpperCase();
    const id=vistas.has(L)?'':' id="com-alt-'+L+'"';
    vistas.add(L);
    return '<span class="com-alt"'+id+'>'+txt+'</span>';
  };
  let s=String(html);
  // Passo 1 — abertura de alternativa em início de parágrafo: "a)", "**a)**", "A -", "b.".
  // Aceita negrito/itálico e &nbsp; entre o começo da linha e a letra, porque o
  // comentário do professor quase sempre vem como "**a)**texto da alternativa".
  const ABRE=/(^|<br>)((?:\s|&nbsp;|<\/?(?:strong|em|b|i)>)*)([a-eA-E])(\s*(?:\)|[.\-\u2013\u2014](?=\s|&nbsp;|<)))/g;
  s=s.replace(ABRE,(m,ini,pre,letra,fecha)=>ini+pre+env(letra,letra+fecha));
  // Passo 2 — referência no corpo do texto: "Letra A", "Alternativa B", "Assertiva C",
  // "Item D", "Opção E". É de longe a forma mais comum (3 de cada 4 comentários).
  const REF_SRC='\\b(Letras?|Alternativas?|Assertivas?|Itens?|Item|Op[\u00e7c][\u00e3a]o)((?:\\s|&nbsp;)+)(<(?:strong|em|b|i)>)?([("\u201c\u0027]?)([a-eA-E])([)"\u201d\u0027]|\\b)(?![\\w\u00c0-\u00ff])';
  // Veredito escrito logo depois ("Letra C – ERRADA") indica a passagem em que o
  // professor de fato COMENTA aquela letra. Muitos comentários citam a letra do
  // gabarito na abertura ("Gabarito: letra C") e só depois a discutem: ancorar na
  // abertura jogaria o salto para o topo, longe da explicação.
  const VERD='(?:[Cc]orret|CORRET|[Ee]rrad|ERRAD|[Ii]ncorret|INCORRET|[Ff]als|FALS|[Cc]ert|CERT|[Vv]erdadeir|VERDADEIR)';
  const trocar=re=>{s=s.replace(re,(m,palavra,esp,tag,abre,letra,fecha)=>
    palavra+esp+(tag||'')+env(letra,(abre||'')+letra+(fecha&&fecha!==''?fecha:'')));};
  trocar(new RegExp(REF_SRC+'(?=[\\s\\S]{0,90}?'+VERD+')','g'));   // prioridade
  trocar(new RegExp(REF_SRC,'g'));                                     // o resto
  return s;
}
function formatarComentarioProfessor(comentario,letraAtual){
  let html=formatQuestionText(limparCabecalhoGabaritoComentario(comentario));
  html=marcarLetrasNoComentario(html);
  html=riscarTrechoSubstituido(html);
  html=html.replace(/<strong>\s*(CORRET[AO]|CERT[AO]|VERDADEIR[AO])([^<]{0,3})<\/strong>/gi,'<strong class="ver-certo">$1$2</strong>');
  html=html.replace(/<strong>\s*(INCORRET[AO]|ERRAD[AO]|FALS[AO])([^<]{0,3})<\/strong>/gi,'<strong class="ver-errado">$1$2</strong>');
  const cabecalho=letraAtual?'<div class="gabarito-header">Gabarito: <span class="letra">LETRA '+esc(letraAtual)+'</span></div>':'';
  return cabecalho+html;
}

// Letra que o professor DECLARA no início do comentário, quando ele não julga item por item.
// Cobre "A alternativa correta é a "B".", "Alternativa correta: E", "Resposta certa "D".",
// "RESPOSTA: A.", "A resposta é letra D" e linha de alternativa fechada com "Certa".
// A letra é sempre lida em maiúscula (ou depois de "letra"), porque "a" minúsculo é artigo:
// "é a letra B" não pode virar alternativa A.
function gabaritoDeclaradoNoComentario(com){
  if(!com)return null;
  const t=String(com)
    .replace(/^\s*\*\*(Professor|Data do coment[áa]rio):\*\*.*$/gm,'')
    .replace(/\*+/g,'').replace(/[“”"']/g,'').replace(/[ \t]+/g,' ')
    .trim().slice(0,900);
  const achados=new Set();
  const FRASES=[
    /(?:alternativa|resposta|op[çc][ãa]o|assertiva)\s+(?:correta|certa)/gi,
    /(?:^|\n)\s*(?:resposta|gabarito)\b/gi,
    /\bresposta\s+[ée]\b/gi
  ];
  FRASES.forEach(re=>{
    let m;
    while((m=re.exec(t))){
      const cauda=t.slice(m.index+m[0].length,m.index+m[0].length+40);
      // com "letra" a letra pode vir em qualquer caixa; sem "letra" só vale maiúscula seguida de
      // pontuação ou fim de linha — "Resposta certa: A alternativa..." não é a alternativa A.
      let l=cauda.match(/^\s*:?\s*(?:[ée]\s*)?(?:a\s+)?letra\s*:?\s*\(?([A-Ea-e])\)?(?![A-Za-zÀ-ÿ])/i)
         ||cauda.match(/^\s*:?\s*(?:[ée]\s*)?(?:a\s+)?\(?([A-E])\)?(?=\s*(?:[.,;:)!]|\n|$))/);
      if(l)achados.add(l[1].toUpperCase());
    }
  });
  // linha de alternativa que o professor fecha com "Certa": 'A) "revelou." Certa'
  const linhas=t.match(/^\s*\(?([A-E])\)[^\n]{0,220}?\bCert[ao]\s*\.?\s*$/gm)||[];
  linhas.forEach(x=>{const m=x.match(/^\s*\(?([A-E])\)/);if(m)achados.add(m[1]);});
  return achados.size===1?[...achados][0]:null;   // dois palpites diferentes = não afirma nada
}

function parseTec(texto){
  const out={questoes:[],problemas:[],fonte:null};
  const mf=texto.match(/^Fonte:\s*(.+)$/m); if(mf)out.fonte=mf[1].trim();
  const blocos=texto.split(/\n##\s+Questao\s+/).slice(1);
  for(const bruto of blocos){
    const numero=(bruto.match(/^(\d+)/)||[])[1]||'?';
    const partes=bruto.split(/\n##\s+Comentario do professor/);
    const corpo=partes[0];
    const comentarioBruto=partes.length>1?partes.slice(1).join('\n'):'';
    const cab=corpo.match(/^#{0,4}\s*#(\d+)\s*-\s*(.+)$/m);
    if(!cab){out.problemas.push({numero,motivo:'sem cabeçalho da questão'});continue;}
    const qid=parseInt(cab[1],10);
    const ident=cab[2].trim();
    const banca=(ident.split(' - ')[0]||'').trim();
    const materia=((corpo.match(/\*\*Materia:\*\*\s*(.+)/)||[])[1]||'').trim();
    const assunto=((corpo.match(/\*\*Assunto:\*\*\s*(.+)/)||[])[1]||'').trim();
    const depois=corpo.slice(corpo.indexOf(cab[0])+cab[0].length);
    let marcadores=[...depois.matchAll(/^\*\*([A-E])\)\*\*[ \t]?/gm)];
    // Sem o negrito — o que acontece quando o .md do coletor vira .docx e volta —
    // vale a escada a) b) c)…, como no caderno impresso.
    if(marcadores.length<2)marcadores=acharMarcadoresAlt(depois);
    if(marcadores.length<2){out.problemas.push({numero,qid,motivo:'menos de 2 alternativas',assunto});continue;}
    const enunciado=depois.slice(0,marcadores[0].index).trim();
    const alternativas=[],letras=[];
    for(let i=0;i<marcadores.length;i++){
      const ini=marcadores[i].index+marcadores[i][0].length;
      const fim=(i+1<marcadores.length)?marcadores[i+1].index:depois.length;
      let txt=depois.slice(ini,fim);
      txt=txt.split(/\n\s*\**Gabarito:/)[0].split(/\n---/)[0];
      alternativas.push(txt.replace(/\s+/g,' ').trim());
      letras.push(marcadores[i][1].toUpperCase());
    }
    const gabs=[...corpo.matchAll(/^\s*\**Gabarito:\**\s*(.*)$/gm)].map(m=>m[1].trim());
    const gabTxt=gabs.length?gabs[gabs.length-1]:'';
    let gabarito=null,aviso=null;
    const letra=(gabTxt.match(/^([A-E])\)/)||gabTxt.match(/^([A-E])$/)||[])[1];
    if(letra){
      gabarito=letras.indexOf(letra);
      // Nunca aceitar um gabarito que não aponte para uma alternativa existente.
      // Questão com gabarito inventado é pior que questão nenhuma: ensina errado.
      if(gabarito<0){gabarito=null;aviso='gabarito "'+letra+'" não existe entre as alternativas';}
    } else if(/anulad/i.test(gabTxt)) aviso='anulada pela banca';
    else aviso=(gabTxt&&gabTxt!=='-')?'gabarito não reconhecido':'sem gabarito no arquivo';
    // Último recurso antes de descartar: o comentário do professor. O coletor deixa a linha
    // "Gabarito:" em "-" quando a questão não foi respondida no TEC, mas o comentário quase
    // sempre diz a resposta. Sem isto, metade de um caderno de inglês era rejeitada.
    // Ordem: (1) professor julgando alternativa por alternativa; (2) letra declarada
    // ("A alternativa correta é a B", "RESPOSTA: A"). Dois palpites diferentes = não afirma.
    let gabDeComentario=false;
    if(gabarito===null&&!/anulad/i.test(gabTxt)&&alternativas.length>=2){
      if(ehCertoErrado(alternativas)){
        const v=vereditoCertoErrado(comentarioBruto);
        if(v){const alvo=alternativas.findIndex(a=>/^certo/i.test(a.trim())===(v==='certo'));if(alvo>=0){gabarito=alvo;gabDeComentario=true;aviso=null;}}
      }else{
        const prof=gabaritoPeloComentario(comentarioBruto);
        let alvo=-1;
        if(prof){const pt=acharAlternativa(alternativas,prof.texto);alvo=pt>=0?pt:letras.indexOf(prof.letra);}
        if(alvo<0){const ld=gabaritoDeclaradoNoComentario(comentarioBruto);if(ld)alvo=letras.indexOf(ld);}
        if(alvo>=0&&alvo<alternativas.length){gabarito=alvo;gabDeComentario=true;aviso=null;}
      }
    }
    if(gabarito===null){out.problemas.push({numero,qid,motivo:aviso,assunto});continue;}
    if(!enunciado){out.problemas.push({numero,qid,motivo:'enunciado vazio',assunto});continue;}
    const comentario=comentarioBruto
      .replace(/^\s*\*\*Professor:\*\*.*$/m,'').replace(/^\s*\*\*Data do comentario:\*\*.*$/m,'')
      .replace(/\n{3,}/g,'\n\n').trim();
    const professor=((comentarioBruto.match(/\*\*Professor:\*\*\s*(.+)/)||[])[1]||'').trim();
    const anc=ancorarGabarito({alternativas,gabarito,comentario,textoFonte:textoDepoisDaLetra(gabTxt)});
    out.questoes.push({qid,banca,ident,materia,assunto,enunciado,alternativas,gabarito:anc.gabarito,
                       gabTexto:anc.gabTexto,conflito:anc.conflito,gabDeComentario,comentario,professor});
  }
  return out;
}

// Formato "Caderno de Estudo" (.txt) do TecConcursos — layout antigo, sem comentário
// Acha os marcadores de alternativa ("a)", "b)", …) no corpo de uma questão do
// caderno impresso do TEC.
//
// A regra antiga exigia recuo — /^\s{2,}([a-e])\)/ — porque no .txt impresso as
// alternativas vêm indentadas e o recuo separava "a)" de alternativa de um "a)"
// solto no meio do enunciado. Só que o recuo não sobrevive a conversão: salvar o
// mesmo caderno como .docx, colar num editor ou passar por um formatador que apara
// espaço à esquerda apaga a indentação — e aí TODAS as questões do arquivo eram
// recusadas com "menos de 2 alternativas", inclusive estando perfeitas.
//
// Em vez do recuo, agora o que qualifica um marcador é a SEQUÊNCIA: alternativa de
// prova começa em "a)" e segue "b)", "c)"… sem pular letra. Uma enumeração perdida
// dentro do enunciado quase nunca forma essa escada completa, e quando forma, fica
// valendo a escada mais próxima do fim do bloco — que é onde ficam as alternativas,
// logo antes da linha "Gabarito:".
function acharMarcadoresAlt(resto){
  // O rótulo pode vir sozinho na linha, com o texto da alternativa começando abaixo
  // (acontece quando a alternativa é uma tabela de lançamentos contábeis). Por isso
  // basta que depois do ")" venha espaço OU o fim da linha — exigir espaço na mesma
  // linha recusava justamente essas.
  const cands=[...resto.matchAll(/^[ \t]*([A-Ea-e])\)(?=[ \t]|\r?$)/gm)];
  if(cands.length<2)return [];
  const corridas=[];let atual=[];
  for(const c of cands){
    const L=c[1].toLowerCase();
    if(L==='a'){if(atual.length>=2)corridas.push(atual);atual=[c];continue;}
    const ant=atual.length?atual[atual.length-1][1].toLowerCase():null;
    if(ant&&L.charCodeAt(0)===ant.charCodeAt(0)+1)atual.push(c);
    else{if(atual.length>=2)corridas.push(atual);atual=[];}
  }
  if(atual.length>=2)corridas.push(atual);
  if(!corridas.length)return [];
  // mais longa vence; empate fica com a última (a que está junto do gabarito)
  let melhor=corridas[0];
  for(const c of corridas)if(c.length>=melhor.length)melhor=c;
  return melhor;
}
function parseTecTxt(texto){
  const out={questoes:[],problemas:[],fonte:null,formato:'txt'};
  const mf=texto.match(/(https:\/\/www\.tecconcursos\.com\.br\/s\/\w+)/);
  if(mf)out.fonte=mf[1];
  const blocos=texto.split(/^\s*www\.tecconcursos\.com\.br\/questoes\/(?=\d)/m).slice(1);
  let ultIdent=null,ultMa=null;        // último cabeçalho visto, para os itens que não trazem o seu
  for(const bruto of blocos){
    const mid=bruto.match(/^(\d+)/); if(!mid){out.problemas.push({numero:'?',motivo:'sem id na URL'});continue;}
    const qid=parseInt(mid[1],10);
    const corpo=bruto.slice(mid[1].length);
    const linhas=corpo.split('\n');
    // 1ª e 2ª linhas não vazias = identificação e matéria-assunto.
    // O .txt é a impressão de uma página web: cabeçalho e rodapé do PDF caem no meio
    // do bloco ("27/05/2026, 20:22", a URL do caderno, "11/30"). Quando isso acontecia
    // na posição da matéria, a questão entrava com matéria = uma data ou um link — e
    // aí some da Meta, porque data nenhuma casa com disciplina do edital.
    const mobilia=l=>/^\d{2}\/\d{2}\/\d{4},?\s*\d{2}:\d{2}/.test(l)   // 27/05/2026, 20:22
                  ||/^https?:\/\//i.test(l)                            // link do caderno
                  ||/tecconcursos\.com\.br/i.test(l)
                  // só o TÍTULO da página impressa é mobília. "Tec Concursos - AFFE
                  // (SEFAZ CE)/2026" é a linha de identificação da questão, não rodapé.
                  ||/^Tec[- ]Concursos\s*[-–]\s*Quest[õo]es para concursos/i.test(l)
                  ||/^\d+\s*\/\s*\d+$/.test(l)                         // 11/30 (página)
                  ||/^Ordena[çc][ãa]o:/i.test(l);
    // O cabeçalho vive ANTES do enunciado. Delimitar por aí evita o erro em que a
    // primeira linha do enunciado virava "matéria" — o que acontecia em todo item de
    // "Julgue o item a seguir" do CEBRASPE, porque o caderno impresso escreve o
    // cabeçalho uma vez e o repete para nenhum dos itens seguintes. Eram 18% das
    // questões do formato .txt entrando com matéria inventada, e matéria inventada
    // não casa com disciplina nenhuma: some da Meta.
    const iEnun=linhas.findIndex(l=>/^\s*\d+\)\s/.test(l));
    const limite=iEnun>=0?iEnun:linhas.length;
    const cand=[];
    for(let i=0;i<limite&&cand.length<2;i++){const l=linhas[i].trim();if(l&&!mobilia(l))cand.push({i,l});}
    // Sem cabeçalho próprio, herda do bloco anterior: o caderno vem ordenado por
    // matéria e assunto, então itens seguidos pertencem ao mesmo tema. Herdar é o
    // que o leitor humano faz ao virar a página.
    let ident,ma;
    if(cand.length>=2){ident=cand[0].l;ma=cand[1].l;ultIdent=ident;ultMa=ma;}
    else if(ultMa!==null){ident=ultIdent||'';ma=ultMa;}
    else{out.problemas.push({numero:qid,qid,motivo:'cabeçalho incompleto'});continue;}
    const banca=(ident.split(' - ')[0]||'').trim();
    const corte=ma.indexOf(' - ');
    const materia=(corte>0?ma.slice(0,corte):ma).trim();
    const assunto=(corte>0?ma.slice(corte+3):'').trim();
    const inicioResto=cand.length>=2?cand[1].i+1:0;
    const resto=linhas.slice(inicioResto).join('\n');
    // enunciado começa em "N)" e vai até a primeira alternativa "a)"
    const mEnun=resto.match(/^\s*\d+\)\s*/m);
    let alts=acharMarcadoresAlt(resto);
    // Itens Certo/Errado (CEBRASPE) não trazem "a)" "b)": vêm como duas linhas soltas.
    let certoErrado=false;
    if(alts.length<2){
      const mCE=resto.match(/^[ \t]*Certo[ \t]*\r?$[\s\S]{0,40}?^[ \t]*Errado[ \t]*\r?$/m);
      if(mCE)certoErrado=true;
      else{out.problemas.push({numero:qid,qid,motivo:'menos de 2 alternativas',assunto});continue;}
    }
    if(certoErrado){
      const iCE=resto.search(/^[ \t]*Certo[ \t]*\r?$/m);
      const enun=resto.slice(mEnun?mEnun.index+mEnun[0].length:0,iCE).replace(/\s+/g,' ').trim();
      const mg2=resto.match(/^\s*Gabarito:\s*(.+)$/m);
      const g=(mg2?mg2[1]:'').trim().toLowerCase();
      let gb=null;
      if(/^certo/.test(g))gb=0; else if(/^errado/.test(g))gb=1;
      else if(/anulad/i.test(g)){out.problemas.push({numero:qid,qid,motivo:'anulada pela banca',assunto});continue;}
      if(gb===null){out.problemas.push({numero:qid,qid,motivo:'gabarito não reconhecido',assunto});continue;}
      if(!enun){out.problemas.push({numero:qid,qid,motivo:'enunciado vazio',assunto});continue;}
      out.questoes.push({qid,banca,ident,materia,assunto,enunciado:enun,alternativas:['Certo','Errado'],gabarito:gb,gabTexto:gb===0?'Certo':'Errado',comentario:'',professor:''});
      continue;
    }
    const enunciado=resto.slice(mEnun?mEnun.index+mEnun[0].length:0,alts[0].index).replace(/\s+/g,' ').trim();
    const alternativas=[],letras=[];
    for(let i=0;i<alts.length;i++){
      const ini=alts[i].index+alts[i][0].length;
      const fim=(i+1<alts.length)?alts[i+1].index:resto.length;
      let txt=resto.slice(ini,fim).split(/\n\s*Gabarito:/)[0];
      alternativas.push(txt.replace(/\s+/g,' ').trim());
      letras.push(alts[i][1].toUpperCase());
    }
    const mg=resto.match(/^\s*Gabarito:\s*(.+)$/m);
    const gabTxt=mg?mg[1].trim():'';
    const letra=(gabTxt.match(/^([A-Ea-e])\b/)||[])[1];
    let gabarito=null,aviso=null;
    if(letra){
      gabarito=letras.indexOf(letra.toUpperCase());
      if(gabarito<0){gabarito=null;aviso='gabarito "'+letra+'" não existe entre as alternativas';}
    } else if(/anulad/i.test(gabTxt)) aviso='anulada pela banca';
    else aviso=gabTxt?'gabarito não reconhecido':'sem gabarito no arquivo';
    if(gabarito===null){out.problemas.push({numero:qid,qid,motivo:aviso,assunto});continue;}
    if(!enunciado){out.problemas.push({numero:qid,qid,motivo:'enunciado vazio',assunto});continue;}
    const anc=ancorarGabarito({alternativas,gabarito,comentario:'',textoFonte:gabTxt.replace(/^[A-Ea-e]\)?\s*/,'')});
    out.questoes.push({qid,banca,ident,materia,assunto,enunciado,alternativas,gabarito:anc.gabarito,
                       gabTexto:anc.gabTexto,conflito:anc.conflito,comentario:'',professor:''});
  }
  return out;
}

// Detecta o formato pelo conteúdo, não pela extensão: o mesmo botão aceita os dois
// exports do TecConcursos — o do coletor (.md, com comentário do professor) e o
// "Caderno de Estudo" (.txt, sem comentário).
// Formato "Capturas TEC com resultado" — gerado pela extensão/Tampermonkey.
// Diferente do coletor: blocos "## Captura N", campos acentuados ("**Matéria:**",
// "## Comentário do professor") e, o mais valioso, o RESULTADO de cada questão:
// "Situacao: Voce errou", "Letra assinalada: A", "Letra correta: E".
function parseTecCapturas(texto){
  const out={questoes:[],problemas:[],fonte:null,formato:'capturas'};
  const mf=texto.match(/Fonte:\s*(https:\/\/www\.tecconcursos\.com\.br\/\S+)/);
  if(mf)out.fonte=mf[1];
  const blocos=texto.split(/\n##\s+Captura\s+/).slice(1);
  for(const bruto of blocos){
    const numero=(bruto.match(/^(\d+)/)||[])[1]||'?';
    const partesCom=bruto.split(/\n##\s+Coment[áa]rio do professor/);
    const corpo=partesCom[0];
    const comentarioBruto=partesCom.length>1?partesCom.slice(1).join('\n'):'';

    const cab=corpo.match(/^#{0,3}\s*#(\d+)\s+(.*)$/m);
    const idSolto=corpo.match(/^ID:\s*#?(\d+)\s*$/m);
    const qid=parseInt((cab&&cab[1])||(idSolto&&idSolto[1])||'',10);
    if(!qid){
      // Distingue "captura vazia" de "faltou o id". A macro avisa quando não conseguiu
      // copiar nada — nesses blocos não há enunciado, alternativa nem comentário, então
      // não é o id que falta: não há questão nenhuma ali. Dizer "sem id" mandava você
      // procurar solução no app, quando o conserto é na macro.
      const vazia=/n[ãa]o foram copiados nesta captura|n[ãa]o alterou o clipboard/i.test(bruto)
                &&!/^\*\*[A-E]\)\*\*/m.test(bruto);
      out.problemas.push({numero,motivo:vazia?'captura vazia — a macro não copiou a questão':'sem id da questão'});
      continue;
    }
    const ident=((cab&&cab[2])||'').trim();
    const banca=(ident.split(/\s+-\s+/)[0]||'').trim();

    const materia=((corpo.match(/^\s*(?:\*\*)?Mat[ée]ria:(?:\*\*)?\s*(.+)$/m)||[])[1]||'').trim();
    const assunto=((corpo.match(/^\s*(?:\*\*)?Assunto:(?:\*\*)?\s*(.+)$/m)||[])[1]||'').trim();

    // o enunciado começa depois do cabeçalho "### #QID ..."
    const depois=cab?corpo.slice(corpo.indexOf(cab[0])+cab[0].length):corpo;
    let marcadores=[...depois.matchAll(/^\*\*([A-E])\)\*\*[ \t]?/gm)];
    // Mesma história do caderno .txt: sem o negrito (conversão para texto puro), o
    // que identifica alternativa é a escada a) b) c)…, não o recuo nem a formatação.
    if(marcadores.length<2)marcadores=acharMarcadoresAlt(depois);
    if(marcadores.length<2){out.problemas.push({numero,qid,motivo:'menos de 2 alternativas',assunto});continue;}
    const enunciado=depois.slice(0,marcadores[0].index).trim();
    const alternativas=[],letras=[];
    for(let i=0;i<marcadores.length;i++){
      const ini=marcadores[i].index+marcadores[i][0].length;
      const fim=(i+1<marcadores.length)?marcadores[i+1].index:depois.length;
      let txt=depois.slice(ini,fim);
      txt=txt.split(/\n\*\*Resultado:\*\*/)[0].split(/\n\s*Resultado:/)[0].split(/\n-{3,}/)[0].split(/\n##/)[0];
      alternativas.push(txt.replace(/\s+/g,' ').trim());
      letras.push(marcadores[i][1].toUpperCase());
    }

    // Gabarito: "Letra correta: E" é o campo mais confiável; "Gabarito: E) ..." é o reserva.
    let letra=((corpo.match(/^Letra correta:\s*([A-E])\b/m)||[])[1])||null;
    if(!letra)letra=((corpo.match(/^Gabarito:\s*([A-E])\)/m)||[])[1])||null;
    const doArquivo=!!letra;
    // Declarações explícitas de letra dentro do comentário. Aceitam aspas, negrito e
    // as duas ordens de escrita — "Gabarito letra \"C\"" e "a alternativa correta é a
    // letra B" — porque cada professor escreve de um jeito e a diferença entre elas
    // era a diferença entre importar a questão e jogá-la fora.
    const ASPAS='["\'“”]?';
    if(!letra)letra=((comentarioBruto.match(new RegExp('Gabarito[^\\n]{0,25}?\\bletra\\s*:?\\s*'+ASPAS+'\\**([A-E])\\b','i'))||[])[1])||null;
    if(!letra)letra=((comentarioBruto.match(new RegExp('(?:alternativa|assertiva|op[çc][ãa]o|resposta)\\s*\\**\\s*(?:correta|certa)\\**[^\\n]{0,25}?\\bletra\\s*\\**\\s*'+ASPAS+'\\**([A-E])\\b','i'))||[])[1])||null;
    if(!letra)letra=((comentarioBruto.match(/\*\*\s*Gabarito\s*:?\s*([A-E])\s*[.*]/i)||[])[1])||null;
    if(!letra)letra=((comentarioBruto.match(/^\s*Gabarito\s*:?\s*([A-E])\b/im)||[])[1])||null;
    let gabarito=null,aviso=null,gabDeComentario=false;
    if(letra){
      gabarito=letras.indexOf(letra.toUpperCase());
      if(gabarito<0){gabarito=null;aviso='gabarito "'+letra+'" não existe entre as alternativas';}
      else if(!doArquivo)gabDeComentario=true;   // a letra veio do comentário, não da captura
    } else if(/anulad/i.test(corpo)) aviso='anulada pela banca';
    else aviso='sem gabarito no arquivo';
    // Último recurso antes de descartar: o professor. Quando a macro falha em copiar o
    // resultado (acontece em captura inteira), o arquivo fica sem linha de gabarito —
    // mas o comentário continua dizendo qual é a resposta. Jogar a questão fora nesse
    // caso é perder material bom por falha de clipboard, não por dado ausente.
    if(gabarito===null&&!/anulad/i.test(corpo)&&alternativas.length>=2){
      const ce=ehCertoErrado(alternativas);
      if(ce){
        const v=vereditoCertoErrado(comentarioBruto);
        if(v){ // casa pelo TEXTO da alternativa, não pela letra: aqui as letras são C) e E)
          const alvo=alternativas.findIndex(a=>/^certo/i.test(a.trim())===(v==='certo'));
          if(alvo>=0){gabarito=alvo;gabDeComentario=true;aviso=null;}
        }
      }else{
        const prof=gabaritoPeloComentario(comentarioBruto);
        if(prof){
          const porTexto=acharAlternativa(alternativas,prof.texto);
          const alvo=porTexto>=0?porTexto:letras.indexOf(prof.letra);
          if(alvo>=0&&alvo<alternativas.length){gabarito=alvo;gabDeComentario=true;aviso=null;}
        }
      }
    }
    if(gabarito===null){out.problemas.push({numero,qid,motivo:aviso,assunto});continue;}
    if(!enunciado){out.problemas.push({numero,qid,motivo:'enunciado vazio',assunto});continue;}

    // Seu resultado naquela captura — guardado, mas sem mexer nos contadores do SM-2.
    const assinalada=((corpo.match(/^Letra assinalada:\s*([A-E])\b/m)||[])[1])||null;
    const sit=((corpo.match(/^Situacao:\s*(.+)$/m)||[])[1]||'').trim();
    let resultadoAnterior=null;
    if(/errou/i.test(sit))resultadoAnterior='errou';
    else if(/acertou/i.test(sit))resultadoAnterior='acertou';
    else if(assinalada&&letra)resultadoAnterior=(assinalada.toUpperCase()===letra.toUpperCase())?'acertou':'errou';

    const comentario=comentarioBruto
      .replace(/^\s*\*\*Professor:\*\*.*$/m,'').replace(/^\s*\*\*Data do coment[áa]rio:\*\*.*$/m,'')
      .split(/\n##\s+Captura\s+/)[0]
      .replace(/\n{3,}/g,'\n\n').trim();
    const professor=((comentarioBruto.match(/\*\*Professor:\*\*\s*(.+)/)||[])[1]||'').trim();

    // O formato Capturas repete o texto da alternativa correta em duas linhas —
    // é a melhor âncora disponível, porque não depende de a letra ter sido lida certo.
    const linhaGab=(corpo.match(/^Alternativa correta detectada:\s*(.+)$/m)||[])[1]
                 ||(corpo.match(/^Gabarito:\s*(.+)$/m)||[])[1]||'';
    const anc=ancorarGabarito({alternativas,gabarito,comentario,textoFonte:textoDepoisDaLetra(linhaGab)});
    out.questoes.push({qid,banca,ident,materia,assunto,enunciado,alternativas,gabarito:anc.gabarito,
                       gabTexto:anc.gabTexto,conflito:anc.conflito,gabDeComentario,
                       comentario,professor,resultadoAnterior,assinalada});
  }
  return out;
}

function detectarFormatoTec(texto){
  if(/\n##\s+Captura\s+\d/.test(texto))return 'capturas';
  if(/\n##\s+Questao\s+\d/.test(texto))return 'md';
  if(/^\s*www\.tecconcursos\.com\.br\/questoes\/\d/m.test(texto))return 'txt';
  return null;
}
// Alguns caminhos de exportação/conversão devolvem o markdown ESCAPADO: "\# TEC
// coletor", "\*\*Materia:\*\*". Aí nenhum padrão bate e o arquivo parecia inválido.
// Só normaliza quando a escapagem está de fato presente, para não mexer em barras
// invertidas legítimas do enunciado de uma questão.
function desescaparMarkdown(t){
  const x=String(t||'');
  if(!/\\#|\\\*\\\*|\\\[/.test(x))return x;
  return x.replace(/\\([#*_`~\[\]()>+\-.!|])/g,'$1');
}
function parseTecAuto(texto){
  texto=desescaparMarkdown(texto);
  const f=detectarFormatoTec(texto);
  if(f==='capturas')return parseTecCapturas(texto);
  if(f==='md')return Object.assign(parseTec(texto),{formato:'md'});
  if(f==='txt')return parseTecTxt(texto);
  return{questoes:[],problemas:[],fonte:null,formato:null};
}

// ===== LEITURA DE .DOCX =====
// O exportador de questões entrega .docx. Converter para .md no meio do caminho
// escapava o markdown e quebrava tudo — mais simples ler o .docx direto.
// Um .docx é um zip com word/document.xml dentro. Aqui o zip é lido na mão e
// descompactado com DecompressionStream, que já existe no navegador: sem
// biblioteca externa, funciona offline e em arquivo local.
function docxDesentidade(s){
  return String(s).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&amp;/g,'&');
}
// Marcadores de imagem/gráfico que sobrevivem ao trajeto texto→markdown→…
// e são desenhados de volta em formatQuestionText(). Ver comentário lá.
const MARCA_IMG_INI='\u0002IMG:',MARCA_IMG_FIM='\u0002';
const MARCA_IMG_FALHA='\u0002IMGFALHA\u0002';
// Lê o diretório central do zip e devolve {nome:{metodo,local,comp}} para
// cada entrada — reaproveitado tanto para word/document.xml quanto para
// as relações (.rels) e as imagens em word/media/.
function zipDiretorio(u8,dv){
  let eocd=-1;
  for(let i=u8.length-22;i>=Math.max(0,u8.length-66000);i--){
    if(dv.getUint32(i,true)===0x06054b50){eocd=i;break;}
  }
  if(eocd<0)throw new Error('arquivo .docx corrompido (sem diretório do zip)');
  const nEnt=dv.getUint16(eocd+10,true);
  let off=dv.getUint32(eocd+16,true);
  const entradas={};
  for(let k=0;k<nEnt&&off+46<=u8.length;k++){
    if(dv.getUint32(off,true)!==0x02014b50)break;
    const nLen=dv.getUint16(off+28,true),eLen=dv.getUint16(off+30,true),cLen=dv.getUint16(off+32,true);
    const nome=new TextDecoder('utf-8').decode(u8.subarray(off+46,off+46+nLen));
    entradas[nome]={metodo:dv.getUint16(off+10,true),local:dv.getUint32(off+42,true),comp:dv.getUint32(off+20,true)};
    off+=46+nLen+eLen+cLen;
  }
  return entradas;
}
async function zipLerEntrada(u8,dv,entrada){
  const L=entrada.local;
  if(dv.getUint32(L,true)!==0x04034b50)throw new Error('cabeçalho interno do .docx inválido');
  const ini=L+30+dv.getUint16(L+26,true)+dv.getUint16(L+28,true);
  const dados=u8.subarray(ini,ini+entrada.comp);
  if(entrada.metodo===0)return dados;
  if(typeof DecompressionStream==='undefined')throw new Error('este navegador não sabe descompactar .docx — exporte em .md ou .txt');
  const fluxo=new Blob([dados]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(fluxo).arrayBuffer());
}
// Antes, tudo que não fosse texto de <w:t> era simplesmente ignorado — inclusive
// <w:drawing> e <w:pict>, que é onde o Word guarda a referência a uma imagem
// (gráfico, tabela em print, etc.). Resultado: questão com figura virava
// enunciado incompleto, sem aviso nenhum. Agora cada referência de imagem vira
// um marcador \u0002IMG:rId\u0002 dentro do parágrafo, na posição exata em que
// ela aparecia — resolvido depois pelo chamador, que já tem o mapa rId→arquivo.
function marcarImagensNoParagrafo(p){
  return p.replace(/<w:drawing>[\s\S]*?<\/w:drawing>|<w:pict>[\s\S]*?<\/w:pict>/g,bloco=>{
    const rid=(bloco.match(/r:embed="([^"]+)"/)||bloco.match(/r:link="([^"]+)"/)||bloco.match(/r:id="([^"]+)"/)||[])[1];
    return rid?(MARCA_IMG_INI+rid+MARCA_IMG_FIM):'';
  });
}
// Tabelas do Word (<w:tbl>) são <w:tr><w:tc><w:p>…, e cada célula é, ela
// mesma, um parágrafo. O extrator de parágrafos comum pegava cada célula
// como se fosse uma linha solta do texto corrido — sem separador entre
// colunas, sem cabeçalho, sem nada que diga o que é o quê. Uma tabela de
// preço/quantidade por ano virava uma pilha de números soltos (exatamente
// o "250 / $9 / 60 / 2024…" sem sentido que aparecia na tela). Aqui a
// tabela inteira é resolvida ANTES do resto do texto: cada linha da tabela
// vira um parágrafo só, com as células separadas por " | ", preservando
// a estrutura — formatQuestionText() depois desenha isso como tabela de verdade.
async function celulaParaTexto(tc,resolverImagem){
  tc=marcarImagensNoParagrafo(tc);
  const comQuebra=tc.replace(/<w:br\s*\/?>/g,' ').replace(/<w:tab\s*\/?>/g,' ');
  const re=/<w:t(?=[ >])[^>]*>[\s\S]*?<\/w:t>|\u0002IMG:[^\u0002]+\u0002/g;
  const pedacos=comQuebra.match(re)||[];
  let texto='';
  for(const p of pedacos){
    if(p.charCodeAt(0)===2){
      const rid=p.slice(MARCA_IMG_INI.length,-1);
      const url=resolverImagem?await resolverImagem(rid):null;
      texto+=url?('[[IMG:'+url+']]'):'[[IMAGEM NÃO IMPORTADA]]';
      continue;
    }
    texto+=docxDesentidade(p.replace(/^<w:t[^>]*>/,'').replace(/<\/w:t>$/,''));
  }
  return texto.replace(/\s+/g,' ').trim();
}
async function tabelaParaParagrafos(tbl,resolverImagem){
  const linhas=tbl.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g)||[];
  const linhasTexto=[];
  for(const tr of linhas){
    const celulas=tr.match(/<w:tc[ >][\s\S]*?<\/w:tc>/g)||[];
    const textos=[];
    for(const tc of celulas)textos.push(await celulaParaTexto(tc,resolverImagem));
    if(textos.some(t=>t!==''))linhasTexto.push(textos.join(' | '));
  }
  if(!linhasTexto.length)return'';
  const escApos=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return linhasTexto.map(l=>'<w:p><w:r><w:t xml:space="preserve">'+escApos(l)+'</w:t></w:p>').join('');
}
async function converterTabelasParaTexto(xml,resolverImagem){
  const re=/<w:tbl>[\s\S]*?<\/w:tbl>/g;
  let saida='',ultimo=0,m;
  while((m=re.exec(xml))){
    saida+=xml.slice(ultimo,m.index);
    saida+=await tabelaParaParagrafos(m[0],resolverImagem);
    ultimo=re.lastIndex;
  }
  saida+=xml.slice(ultimo);
  return saida;
}
async function textoDeDocumentXml(xml,resolverImagem){
  const MARCA=String.fromCharCode(1);
  const paras=xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g)||[];
  const linhas=[];
  for(let p of paras){
    if(resolverImagem)p=marcarImagensNoParagrafo(p);
    const comQuebra=p.replace(/<w:br\s*\/?>/g,MARCA).replace(/<w:tab\s*\/?>/g,'\t');
    const re=/<w:t(?=[ >])[^>]*>[\s\S]*?<\/w:t>|\u0001|\u0002IMG:[^\u0002]+\u0002/g;
    const pedacos=comQuebra.match(re)||[];
    let linha='';
    for(const x of pedacos){
      if(x===MARCA){linha+='\n';continue;}
      if(x.charCodeAt(0)===2){
        const rid=x.slice(MARCA_IMG_INI.length,-1);
        const dataUrl=resolverImagem?await resolverImagem(rid):null;
        linha+='\n'+(dataUrl?('[[IMG:'+dataUrl+']]'):'[[IMAGEM NÃO IMPORTADA]]')+'\n';
        continue;
      }
      linha+=docxDesentidade(x.replace(/^<w:t[^>]*>/,'').replace(/<\/w:t>$/,''));
    }
    linhas.push(linha);
  }
  return linhas.join('\n');
}
async function textoDeDocx(u8){
  const dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength);
  const entradas=zipDiretorio(u8,dv);
  const docEntry=entradas['word/document.xml'];
  if(!docEntry)throw new Error('não achei word/document.xml — o arquivo é mesmo um .docx?');
  const xml=new TextDecoder('utf-8').decode(await zipLerEntrada(u8,dv,docEntry));

  // Mapa rId → caminho do arquivo de mídia, lido de word/_rels/document.xml.rels.
  // Sem isso a referência da imagem (r:embed="rId7") não diz onde está o arquivo.
  const mediaPorRid={};
  const relsEntry=entradas['word/_rels/document.xml.rels'];
  if(relsEntry){
    const relsXml=new TextDecoder('utf-8').decode(await zipLerEntrada(u8,dv,relsEntry));
    for(const tag of relsXml.match(/<Relationship\b[^>]*\/>/g)||[]){
      const id=(tag.match(/\bId="([^"]+)"/)||[])[1];
      const target=(tag.match(/\bTarget="([^"]+)"/)||[])[1];
      const tipo=(tag.match(/\bType="([^"]+)"/)||[])[1]||'';
      if(id&&target&&/\/image$/.test(tipo))mediaPorRid[id]='word/'+target.replace(/^\.?\/+/,'');
    }
  }

  // Converte pra base64 só as imagens realmente referenciadas (e só uma vez cada).
  const cacheB64={};
  async function resolverImagem(rid){
    if(rid in cacheB64)return cacheB64[rid];
    const caminho=mediaPorRid[rid];
    const entrada=caminho&&entradas[caminho];
    if(!entrada)return cacheB64[rid]=null;
    try{
      const bytes=await zipLerEntrada(u8,dv,entrada);
      let bin='';for(let i=0;i<bytes.length;i++)bin+=String.fromCharCode(bytes[i]);
      const ext=(caminho.split('.').pop()||'png').toLowerCase().replace('jpg','jpeg');
      cacheB64[rid]='data:image/'+ext+';base64,'+btoa(bin);
    }catch(e){cacheB64[rid]=null;}
    return cacheB64[rid];
  }

  return await textoDeDocumentXml(await converterTabelasParaTexto(xml,resolverImagem),resolverImagem);
}
// .docx é zip (começa com "PK"); qualquer outra coisa é lida como texto.
async function lerArquivoTec(file){
  const u8=new Uint8Array(await file.arrayBuffer());
  if(u8.length>4&&u8[0]===0x50&&u8[1]===0x4B&&(u8[2]===0x03||u8[2]===0x05)&&(u8[3]===0x04||u8[3]===0x06))
    return await textoDeDocx(u8);
  if(u8.length>4&&u8[0]===0x25&&u8[1]===0x50&&u8[2]===0x44&&u8[3]===0x46)
    throw new Error('PDF não serve: o texto vem embrulhado em formato binário. Exporte em .docx, .md ou .txt.');
  // Alguns exportadores (extensões de navegador, Bloco de Notas do Windows) salvam
  // o .md/.txt em UTF-16 em vez de UTF-8 — sem detectar o BOM, o texto vinha
  // completamente embaralhado e caía em "Não reconheci esse arquivo".
  if(u8.length>=2&&u8[0]===0xFF&&u8[1]===0xFE) return new TextDecoder('utf-16le').decode(u8.slice(2));
  if(u8.length>=2&&u8[0]===0xFE&&u8[1]===0xFF) return new TextDecoder('utf-16be').decode(u8.slice(2));
  return new TextDecoder('utf-8').decode(u8);
}

function escolherTec(){document.getElementById('tec-file').click();}
async function carregarTec(event){
  const input=event.target;
  const files=[...(input.files||[])];if(!files.length)return;
  const acumulado={questoes:[],problemas:[],fontes:[],naoReconhecidos:[]};
  showLoading('Lendo arquivos...',files.length+' arquivo'+(files.length>1?'s':''));
  for(const file of files){
    try{
      const bruto=await lerArquivoTec(file);
      if(!bruto||!String(bruto).trim()){
        acumulado.naoReconhecidos.push({nome:file.name,amostra:'(o arquivo veio vazio na leitura)'});continue;
      }
      const r=parseTecAuto(bruto);
      if(!r.formato)acumulado.naoReconhecidos.push({nome:file.name,amostra:String(bruto).slice(0,160)});
      acumulado.questoes.push(...r.questoes);
      acumulado.problemas.push(...r.problemas.map(p=>({...p,arquivo:file.name})));
      if(r.fonte)acumulado.fontes.push(r.fonte);
    }catch(err){
      acumulado.naoReconhecidos.push({nome:file.name,amostra:'('+err.message+')'});
    }
  }
  try{input.value='';}catch(e){}
  hideLoading();
  previewTec(acumulado,files.length);
}

// Similaridade em lote, em pedaços, para não travar a interface. Só roda depois
// que o QID já eliminou as repetições exatas — aqui o alvo é a questão que voltou
// com OUTRO id, que o QID não pega.
const SIM_LIMIAR_IMPORT=0.85;
// A checagem olhava só o ENUNCIADO, e isso acusa como "duplicata" duas questões diferentes:
//  - as que compartilham o mesmo texto-base (caderno de inglês: várias perguntas sobre o mesmo
//    artigo, cada uma com o texto inteiro dentro do enunciado — ~98% iguais, mas a pergunta muda);
//  - as de enunciado curto igual e alternativas diferentes ("De acordo com a CF, o Ministério Público…").
// Duplicata de verdade tem as ALTERNATIVAS iguais também. A comparação ignora a ordem, porque a
// mesma questão pode sair com as alternativas embaralhadas entre duas exportações.
function alternativasParecidas(a,b){
  a=a||[];b=b||[];
  if(!a.length||!b.length)return true;                 // sem alternativas para comparar: fica como estava
  const f=x=>x.map(s=>String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'')).sort().join('|');
  if(f(a)===f(b))return true;
  return similaridade(a.join(' '),b.join(' '))>=SIM_LIMIAR_IMPORT;
}
async function acharParecidas(novas){
  const idxBanco=questions.map(q=>({q,t:new Set(normTokens(q.questao)),n:impressaoNumerica(q.questao)}));
  const achados=[];
  for(let i=0;i<novas.length;i++){
    const a=new Set(normTokens(novas[i].enunciado)), an=impressaoNumerica(novas[i].enunciado);
    let melhor=null;
    for(const ex of idxBanco){
      if(an!==ex.n)continue;                       // números diferentes = questão diferente
      const sc=similaridade([...a].join(' '),[...ex.t].join(' '));
      if(sc>=SIM_LIMIAR_IMPORT&&alternativasParecidas(novas[i].alternativas,ex.q.alternativas)&&(!melhor||sc>melhor.sc))melhor={sc,ex:ex.q};
    }
    for(let j=0;j<i;j++){
      if(an!==impressaoNumerica(novas[j].enunciado))continue;
      const sc=similaridade(novas[i].enunciado,novas[j].enunciado);
      if(sc>=SIM_LIMIAR_IMPORT&&alternativasParecidas(novas[i].alternativas,novas[j].alternativas)&&(!melhor||sc>melhor.sc))melhor={sc,ex:{questao:novas[j].enunciado,id:novas[j].qid,_lote:true}};
    }
    if(melhor)achados.push({novo:novas[i],...melhor});
    if(i%40===0)await new Promise(r=>setTimeout(r,0));   // devolve o fôlego à interface
  }
  return achados;
}

async function previewTec(r,nArquivos){
  if(!r.questoes.length&&!r.problemas.length){
    const n=(r.naoReconhecidos&&r.naoReconhecidos[0])||null;
    const amostra=n?String(n.amostra||'').replace(/\s+/g,' ').trim().slice(0,90):'';
    alert('Não reconheci esse arquivo como export do TecConcursos.\n\n'+
      (n?'Arquivo: '+n.nome+'\nComeça com: "'+amostra+'..."\n\n':'')+
      'O importador aceita DOIS formatos, sempre em texto:\n\n'+
      '  1) Coletor — tem linhas "## Questao 1"\n'+
      '  2) Capturas — tem linhas "## Captura 1"\n'+
      '  3) Caderno de Estudo — tem linhas "www.tecconcursos.com.br/questoes/123456"\n\n'+
      'O .docx do seu exportador tambem e aceito. So PDF nao serve.');
    return;
  }
  // 1ª barreira: QID. Exata, sem falso positivo, pega reimportação do mesmo caderno.
  const existentes=new Set(questions.map(q=>q.id));
  const vistos=new Set();
  const novas=[],repetidas=[];let nRepBanco=0,nRepLote=0;
  r.questoes.forEach(q=>{
    if(existentes.has(q.qid)){repetidas.push(q);nRepBanco++;}
    else if(vistos.has(q.qid)){repetidas.push(q);nRepLote++;}     // a mesma questão em mais de um arquivo — não é o banco
    else{vistos.add(q.qid);novas.push(q);}
  });
  // Guardadas para a opção de ATUALIZAR: reimportar o mesmo caderno passa a poder
  // corrigir o conteúdo das questões que já estão no banco, sem duplicar e sem
  // zerar agendamento. Antes elas eram simplesmente ignoradas.
  tecRepetidas=repetidas.filter(q=>existentes.has(q.qid));
  tecPlano=null;
  // 2ª barreira: texto + números iguais. Pega a mesma questão com outro QID.
  showLoading('Conferindo duplicatas...',`${novas.length} novas contra ${questions.length} do banco`);
  let parecidas=[];
  try{parecidas=await acharParecidas(novas);}catch(e){console.warn('[QuestIA] checagem de similaridade falhou:',e);}
  hideLoading();
  tecParecidas=new Map(parecidas.map(p=>[p.novo.qid,p]));
  pendingTec=novas;
  const mats={},assuntos=new Set();
  novas.forEach(q=>{mats[q.materia||'—']=(mats[q.materia||'—']||0)+1;assuntos.add(q.materia+' › '+q.assunto);});
  const comCom=novas.filter(q=>q.comentario.length>100).length;
  const el=document.getElementById('tec-preview');
  el.innerHTML=`
    <div class="import-preview-row"><span class="import-preview-label">Arquivos lidos</span><span class="import-preview-val">${nArquivos}</span></div>
    <div class="import-preview-row"><span class="import-preview-label">Questões novas</span><span class="import-preview-val" style="color:var(--green)">${novas.length}</span></div>
    ${nRepBanco?`<div class="import-preview-row"><span class="import-preview-label">Já no banco</span><span class="import-preview-val">${nRepBanco}${(()=>{const m=contarDiferentesTec();return m?` <span style="color:var(--yellow);font-size:12px">(${m} com texto diferente)</span>`:'';})()}</span></div>`:''}
    ${nRepLote?`<div class="import-preview-row"><span class="import-preview-label" title="A mesma questão apareceu em mais de um arquivo selecionado (exportações parciais que se sobrepõem). Não tem relação com o banco.">Repetidas entre os arquivos</span><span class="import-preview-val">${nRepLote}</span></div>`:''}
    ${repetidas.length?'':''}
    ${parecidas.length?`<div class="import-preview-row"><span class="import-preview-label">Possíveis duplicatas (outro id)</span><span class="import-preview-val" style="color:var(--yellow)">${parecidas.length}</span></div>`:''}
    ${r.problemas.length?`<div class="import-preview-row"><span class="import-preview-label">Rejeitadas</span><span class="import-preview-val" style="color:var(--accent)">${r.problemas.length}</span></div>`:''}
    <div class="import-preview-row"><span class="import-preview-label">Com comentário do professor</span><span class="import-preview-val">${comCom}</span></div>
    ${novas.filter(q=>q.gabDeComentario).length?`<div class="import-preview-row"><span class="import-preview-label" title="A captura não trouxe a linha de gabarito, então a resposta foi lida do comentário do professor">Gabarito lido do comentário</span><span class="import-preview-val" style="color:var(--yellow)">${novas.filter(q=>q.gabDeComentario).length}</span></div>`:''}
    ${novas.filter(q=>q.resultadoAnterior).length?`<div class="import-preview-row"><span class="import-preview-label">Trazem seu resultado no TEC</span><span class="import-preview-val">${novas.filter(q=>q.resultadoAnterior==='errou').length} erradas · ${novas.filter(q=>q.resultadoAnterior==='acertou').length} certas</span></div>`:''}
    <div class="import-preview-row"><span class="import-preview-label">Matérias · assuntos</span><span class="import-preview-val">${Object.keys(mats).length} · ${assuntos.size}</span></div>
    ${(()=>{const fora=novas.filter(q=>materiaForaDoEdital(q.materia)).length;return fora?`<div class="import-preview-row"><span class="import-preview-label" title="Matéria não bate com nenhuma linha do EDITAL do Manaus/AFTM">Nascem suspensas (fora do edital)</span><span class="import-preview-val" style="color:var(--yellow)">${fora}</span></div>`:'';})()}</div>`;
  const detalhe=document.getElementById('tec-detalhe');
  // Painel de atualização: só aparece quando o arquivo tem algo a dizer sobre questões que já estão no banco.
  const pl=planoTec(),nMud=pl.ganhos;
  const listaAtu=(pl.ganhos||pl.perdas||pl.semGanho)?`
    <div style="margin-top:16px;padding:14px 16px;background:var(--blue-light);border:1px solid var(--blue-border);border-radius:var(--radius)">
      ${pl.ganhos?`<label style="display:flex;align-items:center;gap:9px;cursor:pointer;font-size:13px;font-weight:600;color:var(--blue-text)">
        <input type="checkbox" id="tec-atualizar" onchange="atualizarBotaoTec()" style="width:16px;height:16px;cursor:pointer">
        Atualizar ${pl.ganhos} questão(ões) em que o arquivo traz MAIS que o banco
      </label>`:`<div style="font-size:13px;font-weight:600;color:var(--blue-text)">Nenhuma questão do banco precisa de atualização</div>`}
      <div style="font-size:12px;color:var(--blue-text);margin-top:8px;line-height:1.7">
        ${pl.gTexto?`<div>· <strong>${pl.gTexto}</strong> ganham imagem ou tabela que o banco não tem</div>`:''}
        ${pl.gCom?`<div>· <strong>${pl.gCom}</strong> ganham o comentário do professor, que está vazio no banco</div>`:''}
        ${pl.perdas?`<div>· <strong>${pl.perdas}</strong> ficam como estão: o arquivo tem <strong>menos</strong> que o banco (perderiam imagem, tabela ou texto) — em geral, exportação de uma versão antiga do coletor</div>`:''}
        ${pl.semGanho?`<div>· <strong>${pl.semGanho}</strong> têm texto diferente, mas sem ganho claro — ficam como estão</div>`:''}
        <div style="margin-top:8px">O app não sabe com qual versão do coletor o arquivo foi gerado; por isso só atualiza quando o arquivo traz <em>mais</em> que o banco.
        Mudam apenas enunciado/alternativas e comentário. <strong>Não são tocados:</strong> matéria e subtema (sua taxonomia), agendamento, acertos, erros e o gabarito que você decidiu.</div>
      </div>
    </div>`:'';
  const listaMat=Object.entries(mats).sort((a,b)=>b[1]-a[1])
    .map(([m,n])=>`<div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0"><span>${esc(m)}</span><span style="font-family:'JetBrains Mono',monospace;color:var(--muted)">${n}</span></div>`).join('');
  const listaDup=parecidas.length?`
    <div style="margin-top:16px;padding:14px 16px;background:var(--yellow-light);border:1px solid rgba(217,119,6,.3);border-radius:var(--radius)">
      <label style="display:flex;align-items:center;gap:9px;cursor:pointer;font-size:13px;font-weight:600;color:var(--yellow-text)">
        <input type="checkbox" id="tec-pular-dup" checked onchange="atualizarBotaoTec()" style="width:16px;height:16px;cursor:pointer">
        Não importar as ${parecidas.length} possíveis duplicatas
      </label>
      <div style="font-size:12px;color:var(--yellow-text);margin-top:8px;line-height:1.6">Texto praticamente igual ao de uma questão que já está no banco, <strong>e com os mesmos números</strong> — questão de cálculo com valores diferentes não é acusada.</div>
      <div style="max-height:200px;overflow:auto;margin-top:10px;font-size:12px;line-height:1.6">
        ${parecidas.slice(0,30).map(p=>`<div style="padding:7px 0;border-top:1px solid rgba(217,119,6,.2)">
          <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--muted)">#${p.novo.qid} ~ ${Math.round(p.sc*100)}% igual a ${p.ex._lote?'outra deste lote (#'+p.ex.id+')':'#'+p.ex.id}</div>
          <div style="color:var(--ink2)">${esc(semMarcadorImg(p.novo.enunciado).replace(/\s+/g,' ').slice(0,120))}…</div>
        </div>`).join('')}
        ${parecidas.length>30?`<div style="padding-top:8px;color:var(--muted)">… e mais ${parecidas.length-30}</div>`:''}
      </div>
    </div>`:'';
  // Resumo por ARQUIVO e por MOTIVO antes da lista item a item. Uma lista de 273
  // linhas iguais não diz nada; "arquivo X — 273 sem alternativa reconhecida" diz
  // na hora que o problema é o arquivo inteiro, não questão a questão.
  const porArq={};
  r.problemas.forEach(p=>{
    const a=p.arquivo||'(arquivo)';
    (porArq[a]=porArq[a]||{})[p.motivo]=((porArq[a]||{})[p.motivo]||0)+1;
  });
  const resumoProb=Object.keys(porArq).map(a=>{
    const m=porArq[a],linhas=Object.keys(m).sort((x,y)=>m[y]-m[x]);
    const total=linhas.reduce((s,k)=>s+m[k],0);
    return `<div style="margin-bottom:7px">
      <div style="font-weight:600;color:var(--ink);word-break:break-all">${esc(a)} — ${total}</div>
      ${linhas.map(k=>`<div style="padding-left:10px">· ${m[k]} × ${esc(k)}</div>`).join('')}
    </div>`;
  }).join('');
  // Quando o arquivo inteiro cai por falta de alternativa, o problema é de formato.
  const tudoSemAlt=r.problemas.filter(p=>/menos de 2 alternativas/.test(p.motivo)).length;
  const dicaFormato=tudoSemAlt>=10?`
    <div style="margin-top:10px;padding:10px;border-radius:8px;background:var(--yellow-light);border:1px solid var(--yellow-border);font-size:12px;color:var(--yellow-text);line-height:1.6">
      <strong>${tudoSemAlt} questões sem alternativa reconhecida.</strong> Quando cai um arquivo quase inteiro assim, o texto perdeu a formatação que separa as alternativas — costuma acontecer ao converter o caderno para outro formato ou ao colar num editor que apara espaços. Exporte de novo direto do TecConcursos, sem passar por conversão.
    </div>`:'';
  const listaProb=r.problemas.length?`
    <div style="margin-top:16px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--accent);margin-bottom:8px">Rejeitadas — não entram</div>
      <div style="font-size:12px;line-height:1.7;color:var(--ink2);margin-bottom:10px">${resumoProb}</div>
      ${dicaFormato}
      <details style="margin-top:8px">
        <summary style="font-size:12px;color:var(--muted);cursor:pointer">ver uma a uma</summary>
        <div style="max-height:180px;overflow:auto;font-size:12px;line-height:1.7;color:var(--ink2);margin-top:6px">
          ${r.problemas.map(p=>`<div>· questão ${esc(p.numero)}${p.qid?` <span style="font-family:'JetBrains Mono',monospace">#${p.qid}</span>`:''} — ${esc(p.motivo)}</div>`).join('')}
        </div>
      </details>
      <div style="font-size:12px;color:var(--muted);margin-top:8px">Questão sem gabarito confiável fica de fora de propósito: importar com gabarito inventado ensinaria o erro como se fosse acerto.</div>
    </div>`:'';
  // Conflito de gabarito: o arquivo diz uma coisa, o professor diz outra. Já vi isso
  // acontecer de verdade neste banco — a linha "Gabarito:" do arquivo estava errada e
  // o professor, explicando alternativa por alternativa, estava certo. Entram mesmo
  // assim (sem o comentário nada seria importado), mas marcadas para você conferir.
  const emConflito=(pendingTec||[]).filter(q=>q.conflito&&q.conflito.tipo==='professor');
  const listaConf=emConflito.length?`
    <div style="margin-top:16px;padding:12px;border-radius:10px;background:var(--yellow-light);border:1px solid var(--yellow-border)">
      <div style="font-size:13px;font-weight:700;color:var(--yellow-text)">⚠️ ${emConflito.length} com gabarito em conflito</div>
      <div style="font-size:12px;color:var(--yellow-text);margin-top:8px;line-height:1.6">O comentário do professor aponta uma alternativa diferente da que está na linha <strong>Gabarito:</strong> do arquivo. Elas entram marcadas — depois é só abrir <strong>Banco → 🔍 Conferir gabaritos</strong> e decidir uma a uma.</div>
      <div style="max-height:150px;overflow:auto;margin-top:10px;font-size:11px;font-family:'JetBrains Mono',monospace;color:var(--yellow-text);line-height:1.8">
        ${emConflito.slice(0,20).map(q=>`<div>#${q.qid} — arquivo: ${'ABCDE'[q.conflito.de]||'?'} · professor: ${esc(q.conflito.letraProf||'')} (${q.conflito.conf})</div>`).join('')}
        ${emConflito.length>20?`<div>… e mais ${emConflito.length-20}</div>`:''}
      </div>
    </div>`:'';
  detalhe.innerHTML=`<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:8px">Por matéria</div>${listaMat}${listaAtu}${listaConf}${listaDup}${listaProb}`;
  atualizarBotaoTec();
  document.getElementById('tec-modal').classList.add('open');
}
// ===== REIMPORTAR PARA CORRIGIR CONTEÚDO =====
// O id de uma questão de banca é o QID do TecConcursos, que não muda entre
// exportações. Isso dá uma propriedade útil: reimportar o mesmo caderno permite
// trocar o TEXTO de uma questão já estudada sem criar uma cópia e sem perder nada
// do aprendizado — repetições, facilidade, intervalo, data da próxima revisão,
// acertos e erros ficam onde estavam, porque nada disso vem do arquivo.
// O que é atualizado vem todo do arquivo; o que é seu, não se toca.
const CAMPOS_DO_ARQUIVO=['questao','alternativas','gabarito','gabTexto','comentario','materia','subtema','origem','banca'];
function textoComparavel(q){
  return JSON.stringify([q.questao||q.enunciado||'',q.alternativas||[]]);
}
// ===== ATUALIZAR SEM PIORAR =====
// O arquivo importado NÃO diz com que versão do coletor foi gerado, então o app não tem como saber
// se ele é mais novo ou mais velho que o texto que já está no banco. O que ele consegue medir é se o
// arquivo TRAZ MAIS (imagem, tabela, comentário) ou MENOS do que o banco já tem — e só o primeiro
// caso atualiza. Antes, qualquer diferença de texto sobrescrevia o banco, inclusive com a versão
// antiga por cima da corrigida (tabela achatada, imagem "não importada").
function _nImg(t){return (String(t||'').match(/\[\[IMG(?:-URL)?:/g)||[]).length;}
function _nImgFalha(t){return (String(t||'').match(/\[\[IMAGEM N[ÃA]O IMPORTADA\]\]/gi)||[]).length;}
function _nLinhasTabela(t){return String(t||'').split('\n').filter(l=>/\S\s*\|\s*\S/.test(l)).length;}
function _blocoTexto(q,ehArquivo){return String(ehArquivo?q.enunciado:q.questao||'')+'\n'+(q.alternativas||[]).join('\n');}
function _normTxt(s){return String(s||'').replace(/\s+/g,' ').replace(/[*_~`>]/g,'').trim();}
function avaliarAtualizacaoTec(atual,novo){
  const a=_blocoTexto(atual,false),n=_blocoTexto(novo,true);
  const r={texto:false,comentario:false,perda:false};
  if(_normTxt(a)!==_normTxt(n)){
    const dImg=_nImg(n)-_nImg(a),dTab=_nLinhasTabela(n)-_nLinhasTabela(a),dFalha=_nImgFalha(n)-_nImgFalha(a);
    const encolheu=_normTxt(n).length<_normTxt(a).length*0.85;
    if(dImg<0||dTab<0||dFalha>0||encolheu)r.perda=true;          // o arquivo tem MENOS que o banco
    else if(dImg>0||dTab>0||dFalha<0)r.texto=true;               // ganho claro: imagem ou tabela que o banco não tem
  }
  const ca=String(atual.comentario||'').trim(),cn=String(novo.comentario||'').trim();
  if(cn.length>=100&&ca.length<40)r.comentario=true;             // banco sem comentário, arquivo com
  return r;
}
let tecPlano=null;
function planoTec(){
  if(tecPlano)return tecPlano;
  const p={itens:[],ganhos:0,gTexto:0,gCom:0,perdas:0,semGanho:0};
  if(tecRepetidas&&tecRepetidas.length){
    const mapa=new Map(questions.map(q=>[q.id,q]));
    tecRepetidas.forEach(novo=>{
      const atual=mapa.get(novo.qid);if(!atual)return;
      const av=avaliarAtualizacaoTec(atual,novo);
      if(av.texto||av.comentario){
        p.itens.push({atual,novo,av});p.ganhos++;
        if(av.texto)p.gTexto++;if(av.comentario)p.gCom++;
      }else if(av.perda)p.perdas++;
      else if(textoComparavel(atual)!==textoComparavel(novo))p.semGanho++;
    });
  }
  return tecPlano=p;
}
function contarMudancasTec(){return planoTec().ganhos;}                       // o que de fato seria atualizado
function contarDiferentesTec(){const p=planoTec();return p.ganhos+p.perdas+p.semGanho;}  // tudo que difere do banco

function aplicarAtualizacoesTec(){
  const plano=planoTec();
  let mudadas=0,gabPreservado=0;
  plano.itens.forEach(({atual,novo,av})=>{
    if(av.texto){
      const gabTextoAntigo=atual.gabTexto;
      atual.questao=novo.enunciado;
      if(JSON.stringify(atual.alternativas)!==JSON.stringify(novo.alternativas)){
        atual.alternativas=novo.alternativas;
        // O gabarito só é mexido se as alternativas mudaram — e aí acompanha o TEXTO da que estava marcada,
        // não a posição, para não trocar a resposta por causa de uma reordenação.
        const i=acharAlternativa(atual.alternativas,gabTextoAntigo);
        if(i>=0){atual.gabarito=i;atual.gabTexto=atual.alternativas[i];gabPreservado++;}
        else{atual.gabarito=novo.gabarito;atual.gabTexto=novo.gabTexto||novo.alternativas[novo.gabarito]||'';}
      }
    }
    if(av.comentario){atual.comentario=novo.comentario;if(novo.gabDeComentario)atual.gabDeComentario=true;}
    // NUNCA tocados aqui: matéria, subtema e origem (a taxonomia que você aplicou), banca, agendamento,
    // acertos, erros, favorita, consolidada, suspensa e o gabarito que você decidiu à mão.
    mudadas++;
  });
  tecPlano=null;
  return {mudadas,gabPreservado};
}
function tecSelecionadas(){
  if(!pendingTec)return[];
  const pular=document.getElementById('tec-pular-dup');
  if(pular&&pular.checked)return pendingTec.filter(q=>!tecParecidas.has(q.qid));
  return pendingTec;
}
function atualizarBotaoTec(){
  const b=document.getElementById('tec-btn-confirmar');if(!b)return;
  const n=tecSelecionadas().length;
  const cx=document.getElementById('tec-atualizar');
  const atu=(cx&&cx.checked)?contarMudancasTec():0;
  b.disabled=!n&&!atu;
  b.textContent=n&&atu?`Importar ${n} e corrigir ${atu}`
               :atu?`Corrigir ${atu} questões`
               :n?`Importar ${n} questões`:'Nada novo para importar';
}

function confirmarImportTec(){
  const sel=tecSelecionadas();
  const cx=document.getElementById('tec-atualizar');
  const querAtualizar=!!(cx&&cx.checked);
  if(!sel.length&&!querAtualizar)return;
  document.getElementById('tec-modal').classList.remove('open');
  const atu=querAtualizar?aplicarAtualizacoesTec():{mudadas:0,gabPreservado:0};
  const hoje=today();
  sel.forEach(q=>{
    questions.push({
      id:q.qid,                                  // QID do TecConcursos: estável entre importações
      questao:q.enunciado,
      alternativas:q.alternativas,
      gabarito:q.gabarito,
      gabTexto:q.gabTexto||q.alternativas[q.gabarito]||'',  // âncora: o gabarito vira texto, não posição
      ...(q.conflito?{conflito:q.conflito}:{}),
      ...(q.gabDeComentario?{gabDeComentario:true}:{}),
      comentario:q.comentario,
      subtema:q.assunto,                         // árvore do TecConcursos, sem trabalho de taxonomia
      origem:`TecConcursos #${q.qid} · ${q.ident}${q.professor?' · coment. '+q.professor:''}`,
      materia:q.materia,
      banca:q.banca||'TecConcursos',
      fonte:'tec',                               // separa os dois regimes de prioridade
      // O formato "Capturas" traz como você foi naquela questão no TecConcursos.
      // Fica registrado, mas NÃO entra em acertos/erros: o SM-2 e a nota prevista
      // contam só o que for respondido aqui dentro.
      ...(q.resultadoAnterior?{resultadoTec:q.resultadoAnterior,assinaladaTec:q.assinalada||null}:{}),
      reps:0,ef:2.5,interval:0,nextDue:hoje,acertos:0,erros:0,favorita:false,consolidada:false,
      // Mesma regra do mkQ: nasce suspensa se a matéria não bate com o EDITAL.
      suspensa:materiaForaDoEdital(q.materia)
    });
  });
  const n=sel.length;pendingTec=null;tecParecidas=new Map();tecRepetidas=[];tecPlano=null;
  save();updateSidebar();renderBackupInfo();initStudy();
  const partes=[];
  if(n)partes.push(`${n} importadas`);
  if(atu.mudadas)partes.push(`${atu.mudadas} corrigidas sem perder agendamento`);
  notify('✓ '+(partes.join(' · ')||'nada a fazer')
    +(atu.gabPreservado?` (${atu.gabPreservado} com gabarito seu preservado)`:''),'ok');
}

// ===== CONFERÊNCIA DE GABARITOS =====
// Varre o banco inteiro comparando o gabarito guardado com o que o professor
// escreveu no comentário. Não muda nada sozinho: lista as divergências lado a lado
// e você decide uma a uma. Questão sem comentário legível não aparece — silêncio
// aqui significa "não deu para conferir", não "está certo".
let pendingConf=[];
function varrerGabaritos(){
  const achados=[];let conferiveis=0;
  questions.forEach(q=>{
    if(!q.alternativas||q.alternativas.length<2)return;
    if(q.conflitoDecidido)return;            // você já olhou esta e decidiu
    const prof=gabaritoPeloComentario(q.comentario);
    if(!prof)return;
    conferiveis++;
    const atual=indiceGabarito(q);
    const porTexto=acharAlternativa(q.alternativas,prof.texto);
    const alvo=porTexto>=0?porTexto:'ABCDE'.indexOf(prof.letra);
    if(alvo<0||alvo>=q.alternativas.length||alvo===atual)return;
    achados.push({id:q.id,atual,alvo,conf:prof.conf,letraProf:prof.letra,viaTexto:porTexto>=0,
                  materia:q.materia||'',enunciado:semMarcadorImg(q.questao||'').replace(/\s+/g,' ').slice(0,150),
                  txtAtual:q.alternativas[atual],txtAlvo:q.alternativas[alvo]});
  });
  // Confiança alta primeiro: são as que o professor julgou alternativa por alternativa.
  achados.sort((a,b)=>(a.conf==='alta'?0:1)-(b.conf==='alta'?0:1));
  return {achados,conferiveis};
}
function conferirGabaritos(){
  const {achados,conferiveis}=varrerGabaritos();
  pendingConf=achados;
  const corpo=document.getElementById('conf-corpo');
  const naoConf=questions.length-conferiveis;
  if(!achados.length){
    corpo.innerHTML=`<div style="padding:18px 0;line-height:1.7">
      <div style="font-size:15px;font-weight:600;color:var(--ink)">Nenhuma divergência encontrada</div>
      <div style="font-size:13px;color:var(--ink2);margin-top:6px">Conferi <strong>${conferiveis}</strong> questões contra o comentário do professor e todas batem.</div>
      ${naoConf>0?`<div style="font-size:12px;color:var(--muted);margin-top:10px">Outras <strong>${naoConf}</strong> ficaram de fora porque não têm comentário em que o professor julgue alternativa por alternativa — nessas não há como conferir, o que não quer dizer que estejam certas.</div>`:''}
    </div>`;
  }else{
    const nAlta=achados.filter(a=>a.conf==='alta').length;
    corpo.innerHTML=`
      <div style="font-size:13px;color:var(--ink2);line-height:1.7;margin-bottom:14px">
        <strong>${achados.length}</strong> questão(ões) em que o professor aponta outra alternativa —
        ${nAlta} com o professor julgando <strong>todas</strong> as alternativas (mais confiável).
        Conferidas ${conferiveis} de ${questions.length}.
      </div>
      ${achados.map((a,i)=>`
        <div style="border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;gap:10px;font-size:10px;font-family:'JetBrains Mono',monospace;color:var(--muted)">
            <span>#${esc(String(a.id))} · ${esc(a.materia)}</span>
            <span style="color:${a.conf==='alta'?'var(--green)':'var(--yellow)'}">${a.conf==='alta'?'confiança alta':'confiança média'}${a.viaTexto?' · casou pelo texto':' · casou pela letra'}</span>
          </div>
          <div style="font-size:12px;color:var(--ink2);margin:6px 0 10px">${esc(a.enunciado)}…</div>
          <div style="font-size:12px;line-height:1.6;padding:7px 9px;border-radius:7px;background:rgba(220,38,38,.07)">
            <strong style="color:var(--red-text)">Hoje o app marca:</strong> ${esc(String(a.txtAtual).slice(0,180))}</div>
          <div style="font-size:12px;line-height:1.6;padding:7px 9px;border-radius:7px;background:rgba(5,150,105,.08);margin-top:5px">
            <strong style="color:var(--green)">O professor diz (${esc(a.letraProf)}):</strong> ${esc(String(a.txtAlvo).slice(0,180))}</div>
          <label style="display:flex;align-items:center;gap:7px;margin-top:9px;font-size:12px;cursor:pointer">
            <input type="checkbox" class="conf-chk" data-i="${i}" ${a.conf==='alta'?'checked':''}>
            Corrigir esta — passar o gabarito para a alternativa do professor
          </label>
        </div>`).join('')}`;
  }
  document.getElementById('conf-aplicar').style.display=achados.length?'inline-flex':'none';
  document.getElementById('conf-modal').classList.add('open');
}
function aplicarConferencia(){
  const marcadas=[...document.querySelectorAll('.conf-chk')].filter(c=>c.checked).map(c=>pendingConf[+c.dataset.i]);
  if(!marcadas.length){document.getElementById('conf-modal').classList.remove('open');return;}
  let n=0;
  marcadas.forEach(a=>{
    const i=questions.findIndex(x=>x.id===a.id);if(i===-1)return;
    questions[i].gabarito=a.alvo;
    questions[i].gabTexto=questions[i].alternativas[a.alvo];   // reancorado no texto novo
    questions[i].conflito=null;
    questions[i].conflitoDecidido='professor';
    n++;
  });
  save();document.getElementById('conf-modal').classList.remove('open');
  renderBanco();notify(`✓ ${n} gabarito(s) corrigido(s)`,'ok');
}
// Preenche gabTexto nas questões que ainda não têm — as que já estavam no banco antes
// desta versão. Sem isso a âncora de texto só valeria para importações novas.
function ancorarBancoExistente(){
  let n=0;
  questions.forEach(q=>{
    if(!q.alternativas||q.alternativas.length<2)return;
    if(!q.gabTexto){
      const i=q.gabarito??0;
      if(q.alternativas[i]!=null){q.gabTexto=q.alternativas[i];n++;}
      return;
    }
    // Âncora e índice não podem discordar: se discordam, o texto manda e o índice
    // é acertado. Deixar os dois fora de sincronia seria guardar uma bomba-relógio
    // para o dia em que a âncora se perdesse num backup antigo.
    const r=indiceGabarito(q);
    if(r!==q.gabarito){q.gabarito=r;n++;}
  });
  return n;
}

function limparTudo(){
  if(!confirm(`Apaga TODAS as ${questions.length} questões e histórico. Sem volta.\nFaça backup antes!`))return;
  questions=[];save();
  // Sem remover a cópia legada, a próxima abertura veria o IndexedDB vazio e
  // reimportaria tudo do localStorage — o "apagar tudo" se desfaria sozinho.
  try{
    localStorage.removeItem('questia_v3');
    Object.keys(localStorage).filter(k=>k.indexOf('questia_snap_')===0).forEach(k=>localStorage.removeItem(k));
  }catch(e){}
  updateSidebar();renderBackupInfo();notify('Banco apagado.','err');
}

// HELPERS
function showLoading(t,s){document.getElementById('loading-text').textContent=t;document.getElementById('loading-sub').textContent=s;document.getElementById('loading').classList.add('show');}
function hideLoading(){document.getElementById('loading').classList.remove('show');}
function notify(msg,type='ok'){const el=document.getElementById('notif');el.textContent=msg;el.className='notif show '+type;setTimeout(()=>el.classList.remove('show'),4000);}

// Verificar se localStorage está disponível
try {
  localStorage.setItem('questia_test','1');
  localStorage.removeItem('questia_test');
} catch(e) {
  document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;text-align:center;padding:20px"><div><div style="font-size:48px;margin-bottom:16px">⚠️</div><h2 style="margin-bottom:8px">Armazenamento bloqueado</h2><p style="color:#666;max-width:400px">Seu navegador está bloqueando o armazenamento local. Verifique se não está em modo privado/anônimo e tente novamente.</p></div></div>';
}

// ===== PINCEL =====
// Rabisco de rascunho sobre o cartão: circular um número, riscar uma pegadinha,
// sublinhar o "EXCETO" do enunciado. Some ao trocar de questão, de propósito —
// é papel de rascunho, não anotação de estudo (essa é a aba Resumos).
//
// Por que nativo e não extensão: o app roda em file://, e a maioria das extensões
// de desenho não injeta script nessa origem. Feito aqui dentro, funciona offline,
// não depende de permissão nenhuma e acompanha o tamanho real do cartão.
let pincelAtivo=false, pincelTracos=[], pincelAtual=null;

function pincelEls(){
  return {fc:document.querySelector('#fc-area .fc'), cv:document.getElementById('fc-pincel')};
}
// O cartão muda de altura a cada questão (enunciado curto vs. tabela gigante), então
// o canvas é remedido sempre que isso acontece. Guardar os traços em coordenadas CSS
// e redesenhar é o que mantém o rabisco no lugar depois de redimensionar a janela —
// mexer no width/height de um canvas apaga o conteúdo dele.
function pincelAjustar(){
  const {fc,cv}=pincelEls(); if(!fc||!cv)return;
  const r=fc.getBoundingClientRect();
  const dpr=window.devicePixelRatio||1;
  const w=Math.max(1,Math.round(r.width)), h=Math.max(1,Math.round(r.height));
  if(cv.width===Math.round(w*dpr)&&cv.height===Math.round(h*dpr))return;
  cv.width=Math.round(w*dpr); cv.height=Math.round(h*dpr);
  cv.style.width=w+'px'; cv.style.height=h+'px';
  pincelRedesenhar();
}
function pincelRedesenhar(){
  const {cv}=pincelEls(); if(!cv)return;
  const ctx=cv.getContext('2d'), dpr=window.devicePixelRatio||1;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,cv.width/dpr,cv.height/dpr);
  ctx.lineCap='round'; ctx.lineJoin='round'; ctx.lineWidth=4;   // 4 circula uma palavra sem cobri-la; acima de 5 o risco engole a letra
  ctx.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()||'#c0392b';
  pincelTracos.forEach(t=>{
    if(t.length<2){  // clique seco vira um ponto, senão sumiria
      if(t.length===1){ctx.beginPath();ctx.arc(t[0].x,t[0].y,2,0,6.284);ctx.fillStyle=ctx.strokeStyle;ctx.fill();}
      return;
    }
    ctx.beginPath(); ctx.moveTo(t[0].x,t[0].y);
    for(let i=1;i<t.length;i++)ctx.lineTo(t[i].x,t[i].y);
    ctx.stroke();
  });
}
function pincelPonto(ev){
  const {fc}=pincelEls(); const r=fc.getBoundingClientRect();
  return {x:ev.clientX-r.left, y:ev.clientY-r.top};
}
function pincelToggle(){
  const {fc}=pincelEls(); if(!fc)return;
  pincelAtivo=!pincelAtivo;
  fc.classList.toggle('pincel-on',pincelAtivo);
  const b=document.getElementById('fc-pincel-btn');
  if(b)b.classList.toggle('ativo',pincelAtivo);
  if(pincelAtivo)pincelAjustar();
}
function pincelDesfazer(){ pincelTracos.pop(); pincelRedesenhar(); }
function pincelLimpar(){ pincelTracos=[]; pincelRedesenhar(); }
// Chamado por showCard: novo cartão, papel limpo. Sai do modo pincel junto, senão
// a próxima questão abriria com o clique nas alternativas bloqueado sem aviso.
function pincelZerar(){
  pincelTracos=[]; pincelAtual=null;
  // Força o desligamento direto (classe + variável) em vez de depender de
  // pincelToggle(): se o HTML tivesse sido salvo com o pincel ligado, o toggle
  // baseado só em pincelAtivo (que sempre começa false) nunca removia a classe
  // 'pincel-on' do cartão, e o canvas continuava capturando clique mesmo com o
  // ícone "apagado". Zerando os dois lados aqui, isso não pode mais acontecer.
  pincelAtivo=false;
  const {fc}=pincelEls();
  if(fc)fc.classList.remove('pincel-on');
  const b=document.getElementById('fc-pincel-btn');
  if(b)b.classList.remove('ativo');
  pincelAjustar(); pincelRedesenhar();
}
(function pincelLigarEventos(){
  const alvo=document.getElementById('fc-pincel'); if(!alvo)return;
  alvo.addEventListener('pointerdown',e=>{
    if(!pincelAtivo)return;
    e.preventDefault(); alvo.setPointerCapture(e.pointerId);
    pincelAtual=[pincelPonto(e)]; pincelTracos.push(pincelAtual);
  });
  alvo.addEventListener('pointermove',e=>{
    if(!pincelAtivo||!pincelAtual)return;
    const p=pincelPonto(e), u=pincelAtual[pincelAtual.length-1];
    if(Math.hypot(p.x-u.x,p.y-u.y)<1.2)return;   // descarta tremor: menos pontos, traço mais limpo
    pincelAtual.push(p); pincelRedesenhar();
  });
  const soltar=()=>{pincelAtual=null;};
  alvo.addEventListener('pointerup',soltar);
  alvo.addEventListener('pointercancel',soltar);
  alvo.addEventListener('pointerleave',soltar);
  window.addEventListener('resize',pincelAjustar);
  // O cartão muda de altura ao revelar o comentário do professor; sem observar isso,
  // o canvas ficaria menor que o cartão e o rabisco pararia no meio.
  const fc=document.querySelector('#fc-area .fc');
  if(fc&&window.ResizeObserver)new ResizeObserver(pincelAjustar).observe(fc);
})();

// ===== ATALHOS DE TECLADO =====
// Antes de responder: 1–5 (ou A–E) marca a alternativa, Enter confirma.
// Depois de responder: 1–4 dá a nota, espaço = Bom (mesma convenção do Anki).
document.addEventListener('keydown',e=>{
  if(e.ctrlKey||e.metaKey||e.altKey)return;
  const t=e.target,tag=(t.tagName||'').toLowerCase();
  if(tag==='input'||tag==='textarea'||tag==='select'||t.isContentEditable)return;
  if(document.querySelector('.modal-bg.open'))return;                       // modal aberto
  const calcAberta=document.getElementById('calc-panel');
  if(calcAberta&&calcAberta.classList.contains('show'))return;              // calculadora tem prioridade no teclado
  const pg=document.getElementById('page-estudar');
  if(!pg||!pg.classList.contains('active'))return;                          // só na aba Estudar
  if(document.getElementById('fc-area').style.display==='none')return;      // fila vazia
  if((e.key||'').toLowerCase()==='p'){e.preventDefault();pincelToggle();return;}  // P = pincel (a–e são das alternativas)
  const respondida=document.getElementById('fc-rate').classList.contains('show');
  if(!respondida){
    let i=-1;
    if(e.key>='1'&&e.key<='9')i=+e.key-1;
    else{const k=(e.key||'').toLowerCase();if(k.length===1&&k>='a'&&k<='e')i=k.charCodeAt(0)-97;}
    const btns=document.querySelectorAll('#fc-alts .alt-btn');
    if(i>=0&&i<btns.length&&!btns[i].disabled){e.preventDefault();btns[i].click();}
    else if(e.key==='Enter'&&altSelecionada!=null){e.preventDefault();confirmarResposta();}       // Enter confirma a alternativa já marcada
  }else{
    let nota=-1;
    if(e.key>='1'&&e.key<='5')nota=+e.key-1;
    else if(e.key===' ')nota=2;
    if(nota>=0){e.preventDefault();rate(nota);return;}
    // já respondida: a-e deixam de escolher e passam a levar ao comentário
    const k=(e.key||'').toLowerCase();
    if(k.length===1&&k>='a'&&k<='e'){e.preventDefault();irParaComentario(k.charCodeAt(0)-97);}
  }
});

// ===== RANKING (export do TecConcursos) =====
// Lê o .json gerado pelo userscript "TEC Ranking → QuestIA", guarda um snapshot por dia
// e REINSERE a sua posição na lista usando o desempenho dos últimos 7 dias do seu
// registro de respostas (o mesmo log que alimenta Estatísticas). Tudo local: nenhum
// dado de outros usuários sai do navegador, e nada aqui mexe no SM-2 nem na fila.
let rkHist={}, rkCarregado=false, rkPend=null;
const rkCfg={nome:'',metrica:'resp',soBanca:false,critPct:'nota',dia:'',mapa:null,v:0};

async function rkCarregar(){
  if(rkCarregado)return; rkCarregado=true;
  try{
    const h=idbOk?await idbLer(ST_META,'ranking_hist'):JSON.parse(localStorage.getItem('questia_ranking_hist')||'null');
    if(h&&typeof h==='object')rkHist=h;
  }catch(e){}
  try{Object.assign(rkCfg,JSON.parse(localStorage.getItem('questia_ranking_cfg')||'{}'));}catch(e){}
  if(rkCfg.v<3){rkCfg.soBanca=false;rkCfg.critPct='nota';rkCfg.v=3;rkSalvarCfg();} // contagem passa a ser a da plataforma inteira, igual à Atividade por dia
}
function rkSalvarHist(){
  if(idbOk)idbGravar(ST_META,rkHist,'ranking_hist').catch(e=>notify('Falha ao salvar o ranking: '+(e&&e.message||e),'err'));
  else{try{localStorage.setItem('questia_ranking_hist',JSON.stringify(rkHist));}catch(e){notify('Armazenamento cheio — não salvei o ranking','err');}}
}
function rkSalvarCfg(){try{localStorage.setItem('questia_ranking_cfg',JSON.stringify(rkCfg));}catch(e){}}
function rkSet(campo,valor){rkCfg[campo]=valor;rkSalvarCfg();renderRanking();}

// "1.234" / "78,5%" / 78.5 -> número
function rkNum(v){
  if(typeof v==='number')return isFinite(v)?v:null;
  if(v==null)return null;
  let s=String(v).replace(/[^\d,.\-]/g,'');
  if(!s||s==='-')return null;
  if(s.indexOf(',')>=0)s=s.replace(/\./g,'').replace(',','.');
  else if(/^-?\d{1,3}(\.\d{3})+$/.test(s))s=s.replace(/\./g,'');
  const n=parseFloat(s);
  return isFinite(n)?n:null;
}
function rkArrays(o,p,acc){
  p=p||0;acc=acc||[];
  if(p>4||o==null)return acc;
  if(Array.isArray(o)){acc.push(o);o.slice(0,3).forEach(x=>rkArrays(x,p+1,acc));}
  else if(typeof o==='object')Object.values(o).forEach(v=>rkArrays(v,p+1,acc));
  return acc;
}
// um nível de aninhamento vira "pai.filho", para a API do TEC (objetos dentro de objetos) virar colunas planas
function rkAchata(o){
  const r={};
  Object.entries(o).forEach(([k,v])=>{
    if(v&&typeof v==='object'&&!Array.isArray(v)){Object.entries(v).forEach(([k2,v2])=>{if(v2===null||typeof v2!=='object')r[k+'.'+k2]=v2;});}
    else if(v===null||typeof v!=='object')r[k]=v;
  });
  return r;
}
function rkCandidatos(d){
  const c=[];
  (d.tabelas||[]).forEach((t,i)=>c.push({rotulo:'Tabela '+(i+1)+' da tela',linhas:(t.linhas||[]).map(l=>{const o=Object.assign({},l);delete o.__classe;return o;})}));
  (d.respostasRede||[]).forEach(r=>{
    rkArrays(r.dados).forEach(a=>{
      if(a.length>=5&&a[0]&&typeof a[0]==='object'&&!Array.isArray(a[0]))
        c.push({rotulo:'Rede: '+String(r.url||'').replace(/^https?:\/\/[^/]+/,'').slice(0,60),linhas:a.map(x=>rkAchata(x||{}))});
    });
  });
  c.sort((a,b)=>b.linhas.length-a.linhas.length);
  return c;
}
function rkColunas(c){
  const s=new Set();
  c.linhas.slice(0,20).forEach(l=>Object.keys(l).forEach(k=>s.add(k)));
  return [...s];
}
function rkMapaInicial(c){
  const cols=rkColunas(c);
  const f=(re,excl)=>cols.find(x=>re.test(x)&&x!==excl)||'';
  // % de acerto: prefere "Desempenho"/"%"/"taxa"; "Acertos" sozinho é contagem, não percentual
  const pct=f(/desemp|%|taxa|aproveit/i)||f(/acert/i);
  return{pos:f(/posi|rank|coloc|^#$/i),nome:f(/nome|usu|aluno|apelido|user/i),
         resp:f(/resolu|resolv|quest|resp|total|feit/i,pct),pct};
}

function rkImportar(ev){
  const file=ev.target.files&&ev.target.files[0];if(!file)return;
  const rd=new FileReader();
  rd.onerror=()=>notify('Não consegui ler o arquivo','err');
  rd.onload=()=>{
    ev.target.value='';
    let d;try{d=JSON.parse(rd.result);}catch(e){notify('JSON inválido','err');return;}
    if(!d||d.tipo!=='tec-ranking'){notify('Esse arquivo não veio do exportador de ranking','err');return;}
    const cand=rkCandidatos(d);
    if(!cand.length){
      alert('Não achei nenhuma lista com várias linhas nesse arquivo.'+(d.textoVisivel?'\n\nEle traz só o texto visível da página — me mande as primeiras linhas dele para eu ajustar o exportador.':''));
      return;
    }
    rkPend={dia:d.dia||today(),cand,sel:0,mapa:null};
    rkPend.mapa=rkMapaInicial(cand[0]);
    if(rkPend.mapa.resp&&rkPend.mapa.nome)rkPendSalvar(); else renderRanking();
  };
  rd.readAsText(file);
}
function rkPendSet(campo,valor){
  if(!rkPend)return;
  if(campo==='sel'){rkPend.sel=+valor;rkPend.mapa=rkMapaInicial(rkPend.cand[rkPend.sel]);}
  else if(campo==='dia')rkPend.dia=valor||today();
  else rkPend.mapa[campo]=valor;
  renderRanking();
}
function rkPendCancelar(){rkPend=null;renderRanking();}
function rkPendSalvar(){
  if(!rkPend)return;
  const c=rkPend.cand[rkPend.sel],m=rkPend.mapa;
  if(!m.resp&&!m.pct){notify('Mapeie ao menos "Respondidas" ou "% de acerto"','err');return;}
  let linhas=c.linhas.map((l,i)=>({
    pos:m.pos?rkNum(l[m.pos]):i+1,
    nome:m.nome?String(l[m.nome]==null?'':l[m.nome]):'#'+(i+1),
    resp:m.resp?rkNum(l[m.resp]):null,
    pct:m.pct?rkNum(l[m.pct]):null
  })).filter(l=>l.resp!==null||l.pct!==null);
  if(!linhas.length){notify('Nenhuma linha com número nas colunas escolhidas','err');return;}
  const pcts=linhas.map(l=>l.pct).filter(x=>x!==null);
  if(pcts.length&&Math.max.apply(null,pcts)<=1)linhas.forEach(l=>{if(l.pct!==null)l.pct=l.pct*100;}); // veio como fração
  rkHist[rkPend.dia]={linhas,mapa:m,origem:c.rotulo,salvoEm:new Date().toISOString()};
  rkCfg.mapa=m;rkCfg.dia=rkPend.dia;
  rkCfg.metrica=m.resp?'resp':'pct';
  rkSalvarCfg();rkSalvarHist();
  const n=linhas.length,dia=rkPend.dia;rkPend=null;
  renderRanking();notify('✓ Ranking de '+dia+' salvo — '+n+' linhas','ok');
}
function rkApagarDia(dia){
  if(!confirm('Apagar o snapshot de '+dia+'?'))return;
  delete rkHist[dia];if(rkCfg.dia===dia)rkCfg.dia='';
  rkSalvarHist();rkSalvarCfg();renderRanking();
}

// ---- seu desempenho numa janela de 7 dias terminando em fimTs ----
function rkMeu(LOG,dia){
  // 7 DIAS DE CALENDÁRIO terminando em `dia` (hoje + 6 anteriores) — a mesma janela do 7D em
  // Estatísticas > Atividade por dia.
  const fim=new Date(dia+'T23:59:59').getTime();
  const b=new Date(dia+'T00:00:00');b.setDate(b.getDate()-6);
  const ini=b.getTime();
  let L=LOG.filter(x=>x.ts>=ini&&x.ts<=fim);
  if(rkCfg.soBanca)L=L.filter(x=>x.fonte==='tec');
  let resp=L.length,dias=new Set(L.map(x=>x.dia)).size,pct=null;
  // critério do %: "nota" = igual à Atividade por dia (só "Errei" conta como erro);
  // "clique" = a alternativa marcada estava certa (o que o TEC mede).
  if(rkCfg.critPct==='clique'){
    const c=L.filter(x=>x.acertouClique!==null&&x.acertouClique!==undefined);
    pct=c.length?c.filter(x=>x.acertouClique).length/c.length*100:null;
  }else{
    const n=L.filter(x=>x.nota!==null&&x.nota!==undefined);
    pct=n.length?n.filter(x=>x.nota!==0).length/n.length*100:null;
  }
  if(!rkCfg.soBanca){
    // Plataforma toda: mesma fonte da Atividade por dia (histCache), o total diário confiável,
    // inclusive de dias anteriores ao registro detalhado de respostas.
    let t=0,d=0,tAc=0;
    for(let k=0;k<7;k++){
      const x=new Date(dia+'T12:00:00');x.setDate(x.getDate()-k);
      const h=histCache[ymd(x)];
      if(h){const n=(h.ac||0)+(h.er||0);t+=n;tAc+=(h.ac||0);if(n)d++;}
    }
    resp=t;dias=d;
    if(rkCfg.critPct!=='clique'&&t>0)pct=tAc/t*100; // bate exatamente com o % da Atividade
  }
  return{resp:resp,pct:pct,dias:dias};
}
function rkFimDoDia(dia){return Math.min(new Date(dia+'T23:59:59').getTime(),Date.now());}
function rkSeparar(linhas){
  const n=(rkCfg.nome||'').trim().toLowerCase();
  if(!n)return{outros:linhas,removida:null};
  const outros=[],rem=[];
  linhas.forEach(l=>{(String(l.nome).toLowerCase().indexOf(n)>=0?rem:outros).push(l);});
  return{outros,removida:rem[0]||null};
}
function rkPosicao(outros,eu,m){
  const v=eu[m];if(v==null)return null;
  const vals=outros.map(l=>l[m]).filter(x=>x!==null&&x!==undefined);
  if(!vals.length)return null;
  const acima=vals.filter(x=>x>v).length;
  return{pos:acima+1,abaixo:acima===vals.length,total:vals.length+1,top:Math.round((acima+1)/(vals.length+1)*1000)/10};
}
function rkFmt(v,m){
  if(v==null)return '—';
  return m==='pct'?(Math.round(v*10)/10).toString().replace('.',',')+'%':Math.round(v).toLocaleString('pt-BR');
}

async function renderRanking(){
  const el=document.getElementById('rk-corpo');if(!el)return;
  await rkCarregar();
  const TH='background:#1e2338;color:#fff;padding:8px 12px;font-size:12px;text-align:left;border:1px solid #2c3352';
  const TD='padding:7px 12px;font-size:12px;border-bottom:1px solid var(--border);color:var(--ink)';
  const dias=Object.keys(rkHist).sort().reverse();
  let html='';

  // ---- importação pendente: escolher a lista e mapear colunas ----
  if(rkPend){
    const c=rkPend.cand[rkPend.sel],cols=rkColunas(c),m=rkPend.mapa;
    const opt=(sel)=>'<option value="">— (não tem)</option>'+cols.map(x=>'<option value="'+esc(x)+'"'+(x===sel?' selected':'')+'>'+esc(x)+'</option>').join('');
    const campo=(rot,k,dica)=>'<div><label class="config-label">'+rot+'</label><select class="config-select" onchange="rkPendSet(\''+k+'\',this.value)">'+opt(m[k])+'</select>'+(dica?'<div style="font-size:11px;color:var(--muted);margin-top:4px">'+dica+'</div>':'')+'</div>';
    html+='<div class="card" style="padding:22px;margin-bottom:22px;border-color:rgba(37,99,235,.4)">'
      +'<div class="chart-title">📥 Importando ranking — confira as colunas</div>'
      +'<div style="font-size:12px;color:var(--muted);line-height:1.6;margin-bottom:14px">Escolhi automaticamente a maior lista do arquivo ('+c.linhas.length+' linhas). Se as colunas abaixo estiverem trocadas, corrija; a escolha fica lembrada para os próximos dias.</div>'
      +'<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:16px">'
      +'<div><label class="config-label">Lista</label><select class="config-select" onchange="rkPendSet(\'sel\',this.value)">'+rkPend.cand.slice(0,12).map((x,i)=>'<option value="'+i+'"'+(i===rkPend.sel?' selected':'')+'>'+esc(x.rotulo)+' · '+x.linhas.length+' linhas</option>').join('')+'</select></div>'
      +'<div><label class="config-label">Data do ranking</label><input type="date" class="config-input" value="'+esc(rkPend.dia)+'" onchange="rkPendSet(\'dia\',this.value)"></div>'
      +campo('Posição','pos','vazio = ordem da lista')+campo('Nome','nome','')+campo('Respondidas','resp','')+campo('% de acerto','pct','')
      +'</div>'
      +'<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%"><tr>'+cols.slice(0,8).map(x=>'<th style="'+TH+'">'+esc(x)+'</th>').join('')+'</tr>'
      +c.linhas.slice(0,5).map(l=>'<tr>'+cols.slice(0,8).map(x=>'<td style="'+TD+'">'+esc(l[x]==null?'':l[x])+'</td>').join('')+'</tr>').join('')
      +'</table></div>'
      +'<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px"><button class="btn btn-ghost" onclick="rkPendCancelar()">Cancelar</button><button class="btn btn-primary" onclick="rkPendSalvar()">💾 Salvar snapshot</button></div>'
      +'</div>';
  }

  if(!dias.length){
    html+='<div class="empty-state"><div class="empty-icon">🏆</div><div class="empty-title">Nenhum ranking importado</div>'
      +'<div class="empty-sub">Rode o userscript na página do TEC, exporte o <strong>.json</strong> e importe aqui em <strong>📥 Importar</strong>.</div></div>';
    el.innerHTML=html;return;
  }

  if(!rkCfg.dia||!rkHist[rkCfg.dia])rkCfg.dia=dias[0];
  const snap=rkHist[rkCfg.dia];
  const m=(rkCfg.metrica==='pct'&&snap.linhas.some(l=>l.pct!==null))||!snap.linhas.some(l=>l.resp!==null)?'pct':'resp';
  const LOG=await lerLog();
  const eu=rkMeu(LOG,rkCfg.dia);
  const {outros,removida}=rkSeparar(snap.linhas);
  const P=rkPosicao(outros,eu,m);
  const P2=rkPosicao(outros,eu,m==='pct'?'resp':'pct');
  const rot={resp:'questões respondidas',pct:'% de acerto'};

  // ---- controles ----
  html+='<div class="card" style="padding:18px 22px;margin-bottom:20px"><div style="display:flex;flex-wrap:wrap;gap:16px;align-items:flex-end">'
    +'<div><label class="config-label">Ranking de</label><select class="config-select" onchange="rkSet(\'dia\',this.value)" style="min-width:150px">'+dias.map(d=>'<option value="'+d+'"'+(d===rkCfg.dia?' selected':'')+'>'+d+'</option>').join('')+'</select></div>'
    +'<div><label class="config-label">Ordenar por</label><select class="config-select" onchange="rkSet(\'metrica\',this.value)" style="min-width:180px"><option value="resp"'+(m==='resp'?' selected':'')+'>Questões respondidas</option><option value="pct"'+(m==='pct'?' selected':'')+'>% de acerto</option></select></div>'
    +'<div><label class="config-label">Meu nome no ranking do TEC</label><input class="config-input" value="'+esc(rkCfg.nome)+'" placeholder="para não me contar duas vezes" onchange="rkSet(\'nome\',this.value)" style="min-width:230px"></div>'
    +'<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;padding-bottom:10px"><input type="checkbox" '+(rkCfg.soBanca?'checked':'')+' onchange="rkSet(\'soBanca\',this.checked)"> só questões de banca</label>'
    +'<div><label class="config-label">% de acerto</label><select class="config-select" onchange="rkSet(\'critPct\',this.value)"><option value="nota"'+(rkCfg.critPct!=='clique'?' selected':'')+'>Igual à Atividade (nota)</option><option value="clique"'+(rkCfg.critPct==='clique'?' selected':'')+'>Alternativa clicada</option></select></div>'
    +'<button class="btn btn-ghost btn-sm" onclick="rkApagarDia(\''+rkCfg.dia+'\')" style="margin-left:auto">🗑 apagar este dia</button>'
    +'</div></div>';

  // ---- cartões ----
  const card=(n,r,cor,sub)=>'<div class="stat-tile"><div class="stat-tile-num" style="font-size:38px;'+(cor?'color:'+cor:'')+'">'+n+'</div><div class="stat-tile-label">'+r+'</div>'+(sub?'<div style="font-size:11px;color:var(--muted);margin-top:6px;line-height:1.5">'+sub+'</div>':'')+'</div>';
  html+='<div class="stats-grid">'
    +card(P?(P.abaixo?'fora do top '+(P.total-1).toLocaleString('pt-BR'):'#'+P.pos.toLocaleString('pt-BR')):'—','Sua posição pelo QuestIA','var(--accent2)',P?(P.abaixo?'abaixo do último da lista exportada — a posição real não dá para saber':'de '+P.total.toLocaleString('pt-BR')+' · top '+String(P.top).replace('.',',')+'%'):'sem dado nos 7 dias')
    +card(eu.resp.toLocaleString('pt-BR'),'Respondidas em 7 dias','',(rkCfg.soBanca?'só banca · ':'plataforma toda · ')+eu.dias+' dia'+(eu.dias===1?'':'s')+' ativo'+(eu.dias===1?'':'s'))
    +card(eu.pct==null?'—':rkFmt(eu.pct,'pct'),'% de acerto em 7 dias','var(--green)',(rkCfg.critPct==='clique'?'pela alternativa clicada':'mesmo critério da Atividade por dia'))
    +card(P2?'#'+P2.pos.toLocaleString('pt-BR'):'—','Pela outra métrica','',rot[m==='pct'?'resp':'pct'])
    +'</div>';

  if(eu.resp===0)html+='<div class="import-warning">Seu registro não tem respostas nos 7 dias que terminam em '+esc(rkCfg.dia)+(rkCfg.soBanca?' com a opção <strong>só questões de banca</strong> marcada — desmarque para contar também as geradas por IA.':'.')+'</div>';
  if(removida)html+='<div style="font-size:12px;color:var(--muted);margin-bottom:12px">No TEC você aparece como <strong>'+esc(removida.nome)+'</strong> (pos. '+esc(removida.pos==null?'—':removida.pos)+', '+rkFmt(removida.resp,'resp')+' resp., '+rkFmt(removida.pct,'pct')+'). Essa linha foi retirada e substituída pela sua estimativa.</div>';

  // ---- tabela com a sua linha reinserida ----
  if(P){
    const ord=outros.slice().sort((a,b)=>(b[m]==null?-Infinity:b[m])-(a[m]==null?-Infinity:a[m]));
    const idx=P.pos-1;
    const lista=ord.slice(0,idx).concat([{__eu:true,nome:'VOCÊ · '+eu.resp.toLocaleString('pt-BR')+' resoluções no QuestIA (7 dias)',resp:eu.resp,pct:eu.pct,pos:null}],ord.slice(idx));
    const mostrar=new Set();
    for(let i=0;i<Math.min(10,lista.length);i++)mostrar.add(i);
    for(let i=Math.max(0,idx-4);i<=Math.min(lista.length-1,idx+4);i++)mostrar.add(i);
    let linhasHtml='',ult=-1;
    [...mostrar].sort((a,b)=>a-b).forEach(i=>{
      if(ult>=0&&i>ult+1)linhasHtml+='<tr><td colspan="5" style="'+TD+';text-align:center;color:var(--muted)">⋮ '+(i-ult-1).toLocaleString('pt-BR')+' posições</td></tr>';
      const l=lista[i],meu=!!l.__eu;
      const bg=meu?'background:rgba(91,142,248,.18);font-weight:700;':'';
      linhasHtml+='<tr style="'+bg+'"><td style="'+TD+'">'+(i+1).toLocaleString('pt-BR')+'</td><td style="'+TD+'">'+(meu?'🎯 ':'')+esc(l.nome)+'</td><td style="'+TD+'">'+rkFmt(l.resp,'resp')+'</td><td style="'+TD+'">'+rkFmt(l.pct,'pct')+'</td><td style="'+TD+';color:var(--muted)">'+(meu?'—':esc(l.pos==null?'—':l.pos))+'</td></tr>';
      ult=i;
    });
    html+='<div class="card" style="padding:22px;margin-bottom:22px"><div class="chart-title">🏆 Ranking de '+esc(rkCfg.dia)+' · ordenado por '+rot[m]+'</div>'
      +'<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%"><tr><th style="'+TH+'">#</th><th style="'+TH+'">Nome</th><th style="'+TH+'">Respondidas</th><th style="'+TH+'">% acerto</th><th style="'+TH+'">Pos. no TEC</th></tr>'+linhasHtml+'</table></div>'
      +'<div style="font-size:11px;color:var(--muted);margin-top:10px;line-height:1.6">A posição das demais linhas é recalculada com você dentro da lista; a última coluna mostra a posição original do TEC.</div></div>';
  }

  // ---- evolução: refaz a sua estimativa para cada snapshot guardado ----
  const evo=dias.slice(0,14).map(d=>{
    const e=rkMeu(LOG,d),o=rkSeparar(rkHist[d].linhas).outros;
    const mm=(m==='pct'&&rkHist[d].linhas.some(l=>l.pct!==null))||!rkHist[d].linhas.some(l=>l.resp!==null)?'pct':'resp';
    return{d,e,p:rkPosicao(o,e,mm)};
  });
  html+='<div class="card" style="padding:22px"><div class="chart-title">📈 Evolução (cada dia refeito com os 7 dias que o antecedem)</div>'
    +'<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%"><tr><th style="'+TH+'">Ranking de</th><th style="'+TH+'">Resp. 7d</th><th style="'+TH+'">% acerto 7d</th><th style="'+TH+'">Posição estimada</th><th style="'+TH+'">Variação</th></tr>'
    +evo.map((x,i)=>{
      const ant=evo[i+1];let v='—',cor='var(--muted)';
      if(x.p&&ant&&ant.p){const dl=ant.p.pos-x.p.pos;v=dl>0?'▲ '+dl.toLocaleString('pt-BR'):dl<0?'▼ '+Math.abs(dl).toLocaleString('pt-BR'):'=';cor=dl>0?'var(--green)':dl<0?'var(--accent)':'var(--muted)';}
      return '<tr><td style="'+TD+'">'+esc(x.d)+'</td><td style="'+TD+'">'+x.e.resp.toLocaleString('pt-BR')+'</td><td style="'+TD+'">'+rkFmt(x.e.pct,'pct')+'</td><td style="'+TD+'">'+(x.p?'#'+x.p.pos.toLocaleString('pt-BR')+' <span style="color:var(--muted)">de '+x.p.total.toLocaleString('pt-BR')+'</span>':'—')+'</td><td style="'+TD+';color:'+cor+';font-weight:700">'+v+'</td></tr>';
    }).join('')+'</table></div></div>';

  el.innerHTML=html;
}

// ===== TEMA =====
function aplicarLabelTema(){
  const dark=document.documentElement.getAttribute('data-theme')==='dark';
  document.getElementById('theme-toggle-icon').textContent=dark?'☀️':'🌙';
  document.getElementById('theme-toggle-label').textContent=dark?'Modo claro':'Modo escuro';
}
function toggleTheme(){
  const dark=document.documentElement.getAttribute('data-theme')==='dark';
  if(dark){document.documentElement.removeAttribute('data-theme');}
  else{document.documentElement.setAttribute('data-theme','dark');}
  try{localStorage.setItem('questia_theme',dark?'light':'dark');}catch(e){}
  aplicarLabelTema();
}
aplicarLabelTema();

// ===== BOOT =====
// A leitura do IndexedDB é assíncrona, então a partida virou async: nada de UI é
// desenhado antes do banco estar em memória, senão a tela abria com "0 questões".
(async function boot(){
  showLoading('Abrindo seu banco...','Carregando as questões do armazenamento local');
  try{
    await iniciarPersistencia();
  }catch(e){
    console.error('[QuestIA] falha na partida:',e);
    notify('Erro na partida: '+(e&&e.message||e),'err');
  }
  hideLoading();
  // Ancora o gabarito das questões que já estavam no banco antes desta versão.
  // Feito uma vez, na partida, para a correção pelo texto valer para o banco inteiro.
  // Devolve o 'fonte' a questões de banca que o perderam ao restaurar um backup
  // antigo. A origem "TecConcursos #..." é assinatura confiável: só a importação do
  // TEC escreve esse texto, e o backup sempre o preservou.
  let fonteRestaurada=0;
  questions.forEach(q=>{
    if(q.fonte==='tec')return;
    if(!/^TecConcursos #/.test(String(q.origem||'')))return;
    q.fonte='tec';fonteRestaurada++;
  });
  if(fonteRestaurada){
    save();
    setTimeout(()=>notify(`🔧 ${fonteRestaurada} questões de banca voltaram a contar na Meta (tinham perdido a marca de origem num backup)`,'ok'),2200);
  }
  // Conserta questões que ficaram com agendamento NaN pelo bug acima. O intervalo
  // anterior foi sobrescrito e não dá para recuperar, então a questão volta para a
  // fila hoje para você reavaliar — errar para o lado de rever uma vez a mais é
  // melhor que deixar conteúdo sumir do agendamento sem ninguém notar.
  let reparadas=0;
  questions.forEach(q=>{
    const ruim=!Number.isFinite(q.interval)||!Number.isFinite(q.ef)
             ||typeof q.nextDue!=='string'||q.nextDue.indexOf('NaN')>=0;
    if(!ruim)return;
    q.interval=Number.isFinite(q.interval)?q.interval:1;
    q.ef=Number.isFinite(q.ef)?q.ef:2.5;
    q.nextDue=today();
    reparadas++;
  });
  if(reparadas){
    save();
    setTimeout(()=>notify(`🔧 ${reparadas} questão(ões) tinham agendamento inválido e voltaram para a fila de hoje — responda de novo para reagendar`,'err'),1800);
  }
  const ancoradas=ancorarBancoExistente();
  if(ancoradas>0)save();
  // Varredura silenciosa: só fala se achar alguma questão cujo gabarito contraria o
  // professor. Nada é alterado aqui — gabarito errado se corrige olhando, não no automático.
  try{
    const {achados}=varrerGabaritos();
    // Carimba o conflito nas questões que já estavam no banco. Sem isso o aviso só
    // existiria para importações novas, e justamente as antigas — as que você já vem
    // estudando com a resposta errada — passariam batido no cartão e no filtro.
    const mapa=new Map(achados.map(a=>[a.id,a]));
    let mudou=0;
    questions.forEach(q=>{
      const a=mapa.get(q.id);
      if(a&&!q.conflitoDecidido){
        const novo={tipo:'professor',de:a.atual,para:a.alvo,letraProf:a.letraProf,conf:a.conf};
        if(JSON.stringify(q.conflito||null)!==JSON.stringify(novo)){q.conflito=novo;mudou++;}
      }else if(q.conflito&&!mapa.has(q.id)){q.conflito=null;mudou++;}
    });
    if(mudou)save();
    const pend=questions.filter(q=>q.conflito).length;
    if(pend)setTimeout(()=>notify(`⚠️ ${pend} questão(ões) com gabarito contrariado pelo professor — o aviso aparece no próprio cartão. Ou veja tudo em Banco → 🔍 Conferir gabaritos.`,'err'),1400);
  }catch(e){console.error('[QuestIA] varredura de gabaritos:',e);}
  loadResumos();
  loadApiKey();carregarModelo();carregarPrefsGerador();updateSidebar();renderMateriaChips();updateMateriaDatalist();initStudy();
  // Unificação de matérias duplicadas (Segurança da Informação / Direito
  // Constitucional) — roda uma vez só, guardada por flag, pra não reprocessar
  // toda partida à toa nem brigar com um rename manual que você faça depois.
  try{
    if(!localStorage.getItem('questia_materias_unificadas_v2')){
      const r=unificarMaterias();
      localStorage.setItem('questia_materias_unificadas_v2','1');
      if(r.questoes||r.resumos||r.dias){
        setTimeout(()=>notify(`✓ Matérias duplicadas unificadas: ${r.questoes} questões, ${r.resumos} resumos, ${r.dias} dias de histórico.`,'ok'),900);
      }
    }
  }catch(e){console.error('[QuestIA] unificação de matérias:',e);}
  snapshotSeguranca();
  // Corrige dias contados a menos por mesclagens antigas (que escolhiam o maior dia em vez de somar).
  reconciliarHistComLog().then(n=>{if(n)setTimeout(()=>notify(`🔧 ${n} dia(s) do histórico recontados a partir do registro de respostas`,'ok'),2600);}).catch(()=>{});
  if(migrouAgora>0){
    setTimeout(()=>notify(`✓ ${migrouAgora} questões migradas para o IndexedDB. A cópia antiga foi mantida como segurança — veja em Backup → Armazenamento.`,'ok'),400);
  }
})();

// ===== RISCO DE BACKUP =====
// A regra antiga disparava se houvesse QUALQUER gravação depois do último export —
// e como responder uma questão grava, o aviso saltava praticamente toda vez que você
// fechava a aba. Aviso que aparece sempre é aviso que ninguém lê.
// Agora só conta o que representa perda real: questões novas que nunca foram
// exportadas, ou um backup muito velho. Responder questão não é risco de perder
// questão — o IndexedDB e os snapshots diários cobrem isso.
const DIAS_BACKUP_VELHO=14, NOVAS_SEM_BACKUP=25;
function riscoBackup(){
  if(!questions.length)return null;
  let le=null,qtd=null;
  try{le=localStorage.getItem('questia_last_export');qtd=parseInt(localStorage.getItem('questia_qtd_ultimo_export')||'',10);}catch(e){}
  if(!le)return 'Você nunca exportou um backup.';
  const dias=Math.floor((Date.now()-new Date(le).getTime())/86400000);
  const novas=Number.isFinite(qtd)?questions.length-qtd:0;
  if(novas>=NOVAS_SEM_BACKUP)return `${novas} questões novas desde o último backup.`;
  if(dias>=DIAS_BACKUP_VELHO)return `Seu último backup tem ${dias} dias.`;
  return null;
}
window.addEventListener('beforeunload',function(e){
  const r=riscoBackup();
  if(!r)return;
  e.preventDefault();e.returnValue=r+' Vá em Backup → Baixar backup antes de fechar.';
  return e.returnValue;
});

// Ponto laranja na aba Backup quando não há backup recente
function checkBackupDot(){
  const navBackup=document.querySelector('.nav-item[onclick="nav(\'backup\')"]');
  if(!navBackup)return;
  navBackup.querySelector('.bk-dot')?.remove();
  const risco=riscoBackup();
  if(risco){
    const dot=document.createElement('span');
    dot.className='bk-dot';
    dot.style.cssText='width:8px;height:8px;border-radius:50%;background:#f59e0b;margin-left:auto;flex-shrink:0;box-shadow:0 0 0 2px rgba(245,158,11,.3)';
    dot.title=risco;
    navBackup.appendChild(dot);
  }
}
setTimeout(checkBackupDot,1500);

// Wrap save para rastrear timestamp
const _origSave=save;
save=function(){_origSave();localStorage.setItem('questia_last_save_ts',Date.now().toString());checkBackupDot();};

// ===== DESEMPENHO NO PERÍODO POR DISCIPLINA =====
// Pedido do Anderson (09/10): estatística de um período escolhido, separada por disciplina
// e assunto, no estilo da tela de desempenho do TEC. Vem do registro de respostas (uma linha
// por resposta), não dos contadores acumulados da questão, por isso respeita o período.
// Acerto = clique na alternativa certa; em resposta antiga sem esse dado, vale a nota
// (qualquer nota diferente de "Errei").
let dpOrdem = 'resp';
const dpAbertas = new Set();
let dpMats = [];
function dpAcertou(r) { return (r.acertouClique === null || r.acertouClique === undefined) ? r.nota > 0 : !!r.acertouClique; }
function dpCard() {
  let c = document.getElementById('dp-card'); if (c) return c;
  const pg = document.getElementById('page-stats'); const body = pg && pg.querySelector('.page-body'); if (!body) return null;
  c = document.createElement('div'); c.id = 'dp-card'; c.className = 'card'; c.style.cssText = 'padding:24px;margin-bottom:24px';
  const inp = "background:var(--surface2);border:1.5px solid var(--border);border-radius:8px;padding:6px 10px;font-family:'Outfit',sans-serif;font-size:12px;color:var(--ink);outline:none;cursor:pointer";
  const btn = "background:var(--surface2);border:1px solid var(--border);color:var(--ink2);border-radius:7px;padding:5px 10px;font-size:11px;font-weight:600;cursor:pointer;font-family:'Outfit',sans-serif";
  c.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px">
    <div class="chart-title" style="margin:0">🎯 Desempenho no período por disciplina</div>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <input type="date" id="dp-de" style="${inp}" onchange="renderDesempenhoPeriodo()">
      <span style="color:var(--muted);font-size:12px">até</span>
      <input type="date" id="dp-ate" style="${inp}" onchange="renderDesempenhoPeriodo()">
      ${[['Hoje', 0], ['7 dias', 6], ['30 dias', 29], ['Tudo', -1]].map(([t, n]) => `<button style="${btn}" onclick="dpPreset(${n})">${t}</button>`).join('')}
    </div></div>
  <div id="dp-resumo" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:12px;margin-bottom:16px"></div>
  <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin-bottom:10px">
    <span style="font-weight:600">Ordem:</span>
    ${[['resp', 'Mais resolvidas'], ['fracos', 'Pontos fracos'], ['fortes', 'Pontos fortes'], ['nome', 'Nome']].map(([k, t]) => `<label style="cursor:pointer;white-space:nowrap"><input type="radio" name="dp-ordem" value="${k}" ${k === dpOrdem ? 'checked' : ''} onchange="dpOrdem=this.value;renderDesempenhoPeriodo()"> ${t}</label>`).join('')}
    <span style="margin-left:auto">Toque numa disciplina para abrir os assuntos</span>
  </div>
  <div id="dp-lista"></div>`;
  body.insertBefore(c, body.children[1] || null); // logo abaixo dos quadros do topo
  dpPreset(29, true);
  return c;
}
function dpPreset(n, silencioso) {
  const ate = today(); let de = '';
  if (n >= 0) { const d = new Date(ate + 'T12:00:00'); d.setDate(d.getDate() - n); de = ymd(d); }
  const a = document.getElementById('dp-de'), b = document.getElementById('dp-ate');
  if (a) a.value = de; if (b) b.value = ate;
  if (!silencioso) renderDesempenhoPeriodo();
}
function dpBarra(ac, er) {
  const t = ac + er, pa = t ? ac / t * 100 : 0;
  return `<div style="display:flex;height:9px;border-radius:5px;overflow:hidden;background:var(--surface2);margin-top:5px"><div style="width:${pa}%;background:var(--green)"></div><div style="width:${t ? 100 - pa : 0}%;background:var(--accent)"></div></div>`;
}
function dpTexto(ac, er) {
  const t = ac + er; if (!t) return '';
  const pa = Math.round(ac / t * 100);
  return `<span style="color:var(--green);font-weight:700">${pa}%</span> <span style="color:var(--muted)">(${ac})</span> <span style="color:var(--accent);font-weight:700">${100 - pa}%</span> <span style="color:var(--muted)">(${er})</span>`;
}
function dpOrdenar(arr) {
  const pct = o => (o.ac + o.er) ? o.ac / (o.ac + o.er) : 0;
  if (dpOrdem === 'fracos') return arr.sort((a, b) => pct(a) - pct(b) || (b.ac + b.er) - (a.ac + a.er));
  if (dpOrdem === 'fortes') return arr.sort((a, b) => pct(b) - pct(a) || (b.ac + b.er) - (a.ac + a.er));
  if (dpOrdem === 'nome') return arr.sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
  return arr.sort((a, b) => (b.ac + b.er) - (a.ac + a.er));
}
function dpToggle(i) {
  const m = dpMats[i]; if (!m) return;
  if (dpAbertas.has(m.nome)) dpAbertas.delete(m.nome); else dpAbertas.add(m.nome);
  renderDesempenhoPeriodo();
}
async function renderDesempenhoPeriodo() {
  const c = dpCard(); if (!c) return;
  const de = document.getElementById('dp-de').value || '', ate = document.getElementById('dp-ate').value || '9999-12-31';
  let L = [];
  try { L = (await lerLog()).filter(r => (!de || r.dia >= de) && r.dia <= ate); } catch (e) { L = []; }
  const porMat = new Map();
  for (const r of L) {
    const nome = (r.materia || 'Sem matéria').trim();
    let o = porMat.get(nome); if (!o) { o = { nome, ac: 0, er: 0, subs: new Map() }; porMat.set(nome, o); }
    const ok = dpAcertou(r); if (ok) o.ac++; else o.er++;
    const sn = (r.subtema || '—').trim(); const so = o.subs.get(sn) || { nome: sn, ac: 0, er: 0 };
    if (ok) so.ac++; else so.er++; o.subs.set(sn, so);
  }
  const tot = L.length, ac = L.filter(dpAcertou).length, er = tot - ac, dias = new Set(L.map(r => r.dia)).size;
  const tile = (v, rot, cor) => `<div class="stat-tile" style="padding:14px"><div class="stat-tile-num" style="font-size:26px${cor ? ';color:' + cor : ''}">${v}</div><div class="stat-tile-label">${rot}</div></div>`;
  document.getElementById('dp-resumo').innerHTML = tot
    ? tile(tot, 'Resolvidas') + tile(ac, 'Acertos', 'var(--green)') + tile(er, 'Erros', 'var(--accent)') + tile(Math.round(ac / tot * 100) + '%', 'Aproveitamento') + tile(porMat.size, 'Disciplinas') + tile(dias, 'Dias com estudo')
    : '';
  dpMats = dpOrdenar([...porMat.values()]);
  const lista = document.getElementById('dp-lista');
  if (!tot) { lista.innerHTML = '<div style="color:var(--muted);font-size:13px">Nenhuma resposta registrada neste período.</div>'; return; }
  lista.innerHTML = dpMats.map((m, i) => {
    const aberta = dpAbertas.has(m.nome);
    const subs = aberta ? dpOrdenar([...m.subs.values()]).map(s => `<div style="padding:7px 0 7px 22px;border-top:1px dashed var(--border)">
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:12px"><span style="color:var(--ink2);flex:1;min-width:160px">${esc(s.nome)}</span><span style="white-space:nowrap"><span style="color:var(--muted);margin-right:8px">${s.ac + s.er}</span>${dpTexto(s.ac, s.er)}</span></div>${dpBarra(s.ac, s.er)}</div>`).join('') : '';
    return `<div style="padding:10px 0;border-top:1px solid var(--border)">
      <div onclick="dpToggle(${i})" style="cursor:pointer">
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:13px"><span style="font-weight:600;color:var(--ink);flex:1;min-width:160px">${aberta ? '▾' : '▸'} ${esc(m.nome)}</span><span style="white-space:nowrap"><span style="color:var(--muted);margin-right:8px">${m.ac + m.er} resolvidas</span>${dpTexto(m.ac, m.er)}</span></div>
        ${dpBarra(m.ac, m.er)}
      </div>${subs}</div>`;
  }).join('');
}
