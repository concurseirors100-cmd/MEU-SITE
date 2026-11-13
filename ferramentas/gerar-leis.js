// Gera a pasta leis/ (textos que vêm com o site, usados pela aba Lei seca).
//
// Entrada: um .txt por lei, com o texto da página do Planalto (document.body.innerText
// com os trechos riscados — <strike> — escondidos). Usa o MESMO separador de artigos
// do site (lsParseLei, em js/leiseca.js), para o resultado ser idêntico ao de colar
// o texto na aba "Textos das leis".
//
// Uso:  node ferramentas/gerar-leis.js <pasta com os .txt> [data AAAA-MM-DD]
// Nomes esperados dos arquivos: ctn.txt, cf.txt, lc87.txt, lc214.txt, lc227.txt,
// ec132.txt, lei6830.txt (os que faltarem são pulados).
const fs=require('fs'),path=require('path'),vm=require('vm');
const raiz=path.join(__dirname,'..');
const LEIS=[
  {arq:'ctn',k:'CTN',fonte:'https://www.planalto.gov.br/ccivil_03/leis/l5172compilado.htm'},
  {arq:'cf',k:'CF/88',fonte:'https://www.planalto.gov.br/ccivil_03/constituicao/ConstituicaoCompilado.htm'},
  {arq:'lc87',k:'LC 87/1996',fonte:'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp87.htm'},
  {arq:'lc214',k:'LC 214/2025',fonte:'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm'},
  {arq:'lc227',k:'LC 227/2026',fonte:'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp227.htm'},
  {arq:'ec132',k:'EC 132/2023',fonte:'https://www.planalto.gov.br/ccivil_03/constituicao/emendas/emc/emc132.htm'},
  {arq:'lei6830',k:'Lei 6.830/1980',fonte:'https://www.planalto.gov.br/ccivil_03/leis/l6830.htm'}
];
// carrega só o separador de artigos do site, com um "document" de mentira
const ctx={document:{createElement:()=>({}),head:{appendChild(){}},addEventListener(){}},console};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(raiz,'js/leiseca.js'),'utf8')+'\n;globalThis.__parse=lsParseLei;',ctx);
const dir=process.argv[2],em=process.argv[3]||new Date().toISOString().slice(0,10);
if(!dir){console.error('Informe a pasta com os .txt');process.exit(1);}
const saida=path.join(raiz,'leis');fs.mkdirSync(saida,{recursive:true});
const indice={};
const gravar=(k,arq,r,fonte)=>{
  fs.writeFileSync(path.join(saida,arq+'.json'),JSON.stringify({lei:k,em,fonte,ordem:r.ordem,arts:r.arts}));
  indice[k]={arquivo:arq+'.json',n:r.ordem.length,em,fonte};
  const nums=r.ordem.map(a=>parseInt(a,10)),max=Math.max(...nums),falt=[];
  for(let i=1;i<=max;i++)if(!nums.includes(i))falt.push(i);
  const maior=r.ordem.map(a=>[a,r.arts[a].length]).sort((x,y)=>y[1]-x[1]).slice(0,3).map(x=>x[0]+' ('+x[1]+')').join(', ');
  console.log(`${k}: ${r.ordem.length} artigos, do ${r.ordem[0]} ao ${r.ordem[r.ordem.length-1]} · citados dentro de outros: ${r.citados} · repetidos: ${r.repetidos} · números ausentes: ${falt.length?falt.join(','):'nenhum'} · maiores: ${maior}`);
};
LEIS.forEach(l=>{
  const f=path.join(dir,l.arq+'.txt');
  if(!fs.existsSync(f)){console.log(l.k+': arquivo '+l.arq+'.txt não encontrado, pulado');return;}
  const r=ctx.__parse(fs.readFileSync(f,'utf8'));
  gravar(l.k,l.arq,r,l.fonte);
  if(r.adct&&r.adct.ordem.length)gravar('ADCT','adct',r.adct,l.fonte);
});
fs.writeFileSync(path.join(saida,'indice.json'),JSON.stringify(indice,null,1));
