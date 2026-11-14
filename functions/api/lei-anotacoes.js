// Cloudflare Pages Function: anotações compartilhadas da Lei Seca.
// O conteúdo oficial da legislação nunca é gravado nem alterado por esta API.
// Acesso público, sem autenticação individual, conforme opção definida para o QuestIA.

const json=(status,data)=>new Response(JSON.stringify(data),{
  status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}
});
const MAX_BODY=20000;
const clean=(v,n)=>String(v??'').slice(0,n);

async function preparar(db){
  await db.prepare(`CREATE TABLE IF NOT EXISTS lei_anotacoes (
    id TEXT PRIMARY KEY,
    doc_key TEXT NOT NULL,
    quote TEXT NOT NULL,
    prefix TEXT NOT NULL DEFAULT '',
    suffix TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT 'yellow',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_lei_anotacoes_doc ON lei_anotacoes(doc_key, updated_at)').run();
}

export async function onRequest({request,env}){
  if(!env.DB)return json(503,{error:'Banco D1 (binding DB) indisponível.'});
  if(!['GET','POST','DELETE'].includes(request.method))return json(405,{error:'Método não permitido.'});
  try{
    await preparar(env.DB);
    if(request.method==='GET'){
      const doc=clean(new URL(request.url).searchParams.get('doc'),240);
      if(!doc)return json(400,{error:'Documento não informado.'});
      const r=await env.DB.prepare('SELECT id,doc_key,quote,prefix,suffix,kind,color,note,created_at,updated_at FROM lei_anotacoes WHERE doc_key=? ORDER BY created_at').bind(doc).all();
      return json(200,{annotations:r.results||[]});
    }
    if(request.method==='POST'){
      const raw=await request.text();
      if(raw.length>MAX_BODY)return json(413,{error:'Anotação muito grande.'});
      let x;try{x=JSON.parse(raw)}catch{return json(400,{error:'JSON inválido.'})}
      const id=clean(x.id,80),doc=clean(x.doc_key,240),quote=clean(x.quote,3000);
      const kind=['highlight','underline','note'].includes(x.kind)?x.kind:'';
      const color=['yellow','green','blue','pink','purple'].includes(x.color)?x.color:'yellow';
      const note=clean(x.note,4000),prefix=clean(x.prefix,100),suffix=clean(x.suffix,100);
      if(!id||!doc||!quote||!kind)return json(400,{error:'Campos obrigatórios ausentes.'});
      const now=new Date().toISOString();
      await env.DB.prepare(`INSERT INTO lei_anotacoes(id,doc_key,quote,prefix,suffix,kind,color,note,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET doc_key=excluded.doc_key,quote=excluded.quote,prefix=excluded.prefix,
        suffix=excluded.suffix,kind=excluded.kind,color=excluded.color,note=excluded.note,updated_at=excluded.updated_at`)
        .bind(id,doc,quote,prefix,suffix,kind,color,note,now,now).run();
      return json(200,{ok:true,id,updated_at:now});
    }
    const raw=await request.text();
    if(raw.length>2000)return json(413,{error:'Requisição muito grande.'});
    let x;try{x=JSON.parse(raw)}catch{return json(400,{error:'JSON inválido.'})}
    const id=clean(x.id,80);if(!id)return json(400,{error:'Identificador ausente.'});
    await env.DB.prepare('DELETE FROM lei_anotacoes WHERE id=?').bind(id).run();
    return json(200,{ok:true});
  }catch(e){
    return json(500,{error:'Falha ao acessar as anotações.',detail:clean(e&&e.message,300)});
  }
}
